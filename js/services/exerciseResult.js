import { reviewChannel } from './fsrsConfig.js';
import { requestSchedulerTraining } from './fsrsLearning.js';
import { sourceDefinitionFingerprint } from './learningDefinitions.js?v=18900';
import { memoryContextFeatures } from './memoryFeatures.js';
import { driveSync } from './driveSync.js?v=18900';
import { migrateSrsState, scheduleWordReviewDetailed } from './srsEngine.js?v=18900';
import { recordLearningExercise } from './learningStats.js?v=18900';
import { normalizeWordPracticeStats, updateWordPracticeStats } from './wordSelection.js?v=18900';

export const EXERCISE_RESULT_VERSION = 2;
const resultId = () => globalThis.crypto?.randomUUID?.() || `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const sessions = new Map();

const RECALL_TYPES = new Set(['recognition', 'free-recall', 'listening-recall', 'context', 'productive', 'speaking']);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function normalizeMastery(word, now = new Date()) {
  const current = word?.mastery && typeof word.mastery === 'object' ? word.mastery : {};
  const seenAt = current.seenAt || word?.createdAt || now.toISOString();
  return {
    version: 1,
    seenAt,
    recognition: clamp(current.recognition),
    recall: clamp(current.recall),
    context: clamp(current.context),
    productive: clamp(current.productive),
    speaking: clamp(current.speaking),
    lastPracticedAt: current.lastPracticedAt || word?.lastReviewedAt || '',
    lastExerciseType: String(current.lastExerciseType || '')
  };
}

export function masteryStage(mastery) {
  if (Math.max(mastery.productive, mastery.speaking) >= 0.65) return 'productive';
  if (mastery.context >= 0.6) return 'context';
  if (mastery.recall >= 0.6) return 'recalled';
  if (mastery.recognition >= 0.45) return 'recognized';
  return 'seen';
}

export function normalizeMistakes(word) {
  const current = word?.mistakes && typeof word.mistakes === 'object' ? word.mistakes : {};
  return {
    version: 1,
    incorrectAttempts: Math.max(0, Math.round(Number(current.incorrectAttempts) || 0)),
    consecutiveFailures: Math.max(0, Math.round(Number(current.consecutiveFailures) || 0)),
    recentFailures: Array.isArray(current.recentFailures) ? current.recentFailures.slice(-20) : [],
    lastMistakeAt: String(current.lastMistakeAt || ''),
    byExercise: current.byExercise && typeof current.byExercise === 'object' ? { ...current.byExercise } : {},
    confusions: current.confusions && typeof current.confusions === 'object' ? { ...current.confusions } : {}
  };
}

export function normalizeExerciseResult(input) {
  if (!input?.wordId) throw new Error('Exercise results require a word ID.');
  if (!input?.exerciseType) throw new Error('Exercise results require an exercise type.');
  const recallType = RECALL_TYPES.has(input.recallType) ? input.recallType : 'recognition';
  return {
    version: EXERCISE_RESULT_VERSION,
    id: String(input.id || resultId()),
    sessionId: String(input.sessionId || '').slice(0, 150), position: Math.max(0, Math.round(Number(input.position) || 0)),
    wordId: String(input.wordId),
    exerciseType: String(input.exerciseType),
    correct: Boolean(input.correct) && input.learnerRating !== 'again',
    responseTimeMs: input.responseTimeMs != null && input.responseTimeMs !== '' && Number.isFinite(Number(input.responseTimeMs))
      ? Math.max(0, Number(input.responseTimeMs)) : null,
    hintsUsed: Math.max(0, Math.round(Number(input.hintsUsed) || 0)),
    recallType,
    producedUnaided: input.producedUnaided == null ? Boolean(input.correct && !input.hintsUsed && !['recognition', 'context'].includes(recallType)) : Boolean(input.producedUnaided),
    confidence: input.confidence == null ? null : clamp(input.confidence),
    confusedWithWordId: input.confusedWithWordId ? String(input.confusedWithWordId) : '',
    learnerRating: ['again', 'hard', 'good', 'easy'].includes(input.learnerRating) ? input.learnerRating : '',
    learnerResponse: String(input.learnerResponse || '').trim().slice(0, 1000),
    occurredAt: input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString()
  };
}

export function scoreExerciseEvidence(input, word) {
  const result = normalizeExerciseResult(input);
  if (!result.correct) {
    return { ...result, rating: 'again', evidenceStrength: result.recallType === 'recognition' ? 0.55 : 0.85 };
  }
  if (result.learnerRating) {
    const strength = { again: 0.55, hard: 0.42, good: 0.68, easy: 0.9 }[result.learnerRating];
    return { ...result, rating: result.learnerRating, evidenceStrength: strength };
  }

  const base = {
    recognition: 0.34,
    'free-recall': 0.76,
    'listening-recall': 0.8,
    context: 0.82,
    productive: 0.94,
    speaking: 1
  }[result.recallType];
  const hintPenalty = Math.min(0.55, result.hintsUsed * 0.2);
  const unaidedBoost = result.producedUnaided ? 0.08 : 0;
  const speedBoost = result.responseTimeMs != null && result.responseTimeMs <= 8_000 ? 0.06 : 0;
  const confidenceAdjustment = result.confidence == null ? 0 : (result.confidence - 0.5) * 0.08;
  const evidenceStrength = clamp(base - hintPenalty + unaidedBoost + speedBoost + confidenceAdjustment, 0.15, 1);
  const average = word?.practiceStats?.timedRecallCount ? word.practiceStats.recallTimeTotalMs / word.practiceStats.timedRecallCount : 0;
  const expected = average || (['productive', 'speaking'].includes(result.recallType) ? 30000 : 10000 + String(word?.word || '').length * 300);
  const slow = result.responseTimeMs != null && result.responseTimeMs < 120000 && result.responseTimeMs > Math.max(20000, expected * 2);
  const rating = result.hintsUsed || slow || (result.confidence != null && result.confidence < 0.4) ? 'hard'
    : result.producedUnaided && result.confidence >= 0.9 && result.responseTimeMs != null && result.responseTimeMs < expected ? 'easy' : 'good';
  return { ...result, rating, evidenceStrength };
}

function updateMastery(mastery, result) {
  const next = { ...mastery, lastPracticedAt: result.occurredAt, lastExerciseType: result.exerciseType };
  const field = reviewChannel(result) !== 'recall' ? 'recognition' : result.recallType === 'listening-recall' ? 'recall' : result.recallType === 'free-recall' ? 'recall' : result.recallType;
  if (result.correct) {
    next[field] = clamp(next[field] + 0.18 + result.evidenceStrength * 0.28);
    if (field !== 'recognition') next.recognition = clamp(next.recognition + 0.08);
  } else {
    next[field] = clamp(next[field] - (field === 'recognition' ? 0.08 : 0.16));
  }
  next.stage = masteryStage(next);
  return next;
}

function updateMistakes(mistakes, result) {
  if (result.correct) return { ...mistakes, consecutiveFailures: 0 };
  const byExercise = { ...mistakes.byExercise, [result.exerciseType]: Number(mistakes.byExercise[result.exerciseType] || 0) + 1 };
  const confusions = { ...mistakes.confusions };
  if (result.confusedWithWordId) confusions[result.confusedWithWordId] = Number(confusions[result.confusedWithWordId] || 0) + 1;
  return {
    ...mistakes,
    incorrectAttempts: mistakes.incorrectAttempts + 1,
    consecutiveFailures: mistakes.consecutiveFailures + 1,
    recentFailures: [...mistakes.recentFailures, result.occurredAt].slice(-20),
    lastMistakeAt: result.occurredAt,
    byExercise,
    confusions
  };
}

export function applyExerciseResultToWord(word, input, options = {}) {
  const result = scoreExerciseEvidence(input, word);
  if (word.srs?.recentEventIds?.includes(result.id)) return { word, result, duplicate: true };
  const now = new Date(result.occurredAt);
  const migrated = migrateSrsState(word, now);
  const practiceStats = updateWordPracticeStats(migrated, result);
  // Late-arriving results retain their statistics without moving a newer
  // review schedule or the last recall timestamp back in time.
  if (now.getTime() < Date.parse(normalizeWordPracticeStats(word).lastAnsweredAt)) {
    const channel = reviewChannel(result);
    const card = migrated.srs.cards[channel];
    return { word: { ...word, practiceStats, srs: { ...word.srs, recentEventIds: [...(word.srs?.recentEventIds || []), result.id].slice(-24) } }, result,
      transition: { channel, grade: ['again', 'hard', 'good', 'easy'].indexOf(result.rating) + 1, before: card, after: card, scheduled: false } };
  }
  const review = scheduleWordReviewDetailed(migrated, result.rating, { now, settings: options.settings, evidenceStrength: result.evidenceStrength, result });
  const scheduled = review.word;
  scheduled.srs.recentEventIds = [...(scheduled.srs.recentEventIds || []), result.id].slice(-24);
  const mastery = updateMastery(normalizeMastery(scheduled, now), result);
  const mistakes = updateMistakes(normalizeMistakes(scheduled), result);
  return {
    word: {
      ...scheduled,
      mastery,
      mistakes,
      practiceStats,
      productiveSamples: result.learnerResponse && ['productive', 'speaking'].includes(result.recallType)
        ? [...(Array.isArray(scheduled.productiveSamples) ? scheduled.productiveSamples : []), { text: result.learnerResponse, exerciseType: result.exerciseType, correct: result.correct, createdAt: result.occurredAt }].slice(-20)
        : scheduled.productiveSamples,
      lastExerciseResult: {
        version: result.version,
        id: result.id, confidence: result.confidence, sessionId: result.sessionId, position: result.position,
        exerciseType: result.exerciseType,
        correct: result.correct,
        recallType: result.recallType,
        producedUnaided: result.producedUnaided,
        hintsUsed: result.hintsUsed,
        responseTimeMs: result.responseTimeMs,
        rating: result.rating,
        evidenceStrength: result.evidenceStrength,
        occurredAt: result.occurredAt
      }
    },
    result, transition: review.transition
  };
}

export function recordExerciseResult(input, persistence = driveSync) {
  const words = persistence.getWords();
  const index = words.findIndex(word => word.id === input?.wordId);
  if (index === -1) throw new Error('That vocabulary item no longer exists.');
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  let session = sessions.get(input.exerciseType);
  if (!session || occurredAt.getTime() - session.lastAt > 30 * 60000 || occurredAt.getTime() < session.lastAt) session = { id: resultId(), position: 0 };
  session.lastAt = occurredAt.getTime(); session.position += 1; sessions.set(input.exerciseType, session);
  const normalized = { ...input, sessionId: input.sessionId || session.id, position: input.position ?? session.position };
  const original = words[index];
  const applied = applyExerciseResultToWord(original, normalized, { settings: persistence.getSettings?.() });
  if (applied.duplicate) return applied;
  words[index] = applied.word;
  persistence.saveWords(words);
  persistence.recordReview(new Date(applied.result.occurredAt));
  recordLearningExercise(applied.result, persistence);
  if (applied.transition && persistence.appendReviewEvent) {
    const event = { ...applied.result, deviceId: persistence.deviceId || '', channel: applied.transition.channel, grade: applied.transition.grade,
      senseId: sourceDefinitionFingerprint(original), monthYear: original.monthYear || '', memory: applied.transition,
      context: memoryContextFeatures(original, occurredAt, { stats: normalizeWordPracticeStats(original), position: applied.result.position }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', utcOffsetMinutes: -occurredAt.getTimezoneOffset() };
    void persistence.appendReviewEvent(event).then(() => requestSchedulerTraining(persistence)).catch(() => {});
  }
  return applied;
}
