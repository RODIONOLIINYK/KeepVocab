import { getDueWords } from './srsEngine.js?v=1602';
import { masteryStage, normalizeMastery, normalizeMistakes } from './exerciseResult.js?v=1602';
import { normalizeWordPracticeStats, selectModeWords, wordRecommendationScore } from './wordSelection.js?v=1602';

export const DEFAULT_SESSION_SIZE = 20;
export const DEFAULT_SESSION_WORD_COUNT = DEFAULT_SESSION_SIZE;
export const DEFAULT_SESSION_MIX = Object.freeze({ due: 0.35, weak: 0.5, growth: 0.15 });
const DAY_MS = 24 * 60 * 60 * 1000;

export function practiceSessionSize(settings = {}) {
  return Math.max(5, Math.min(50, Math.round(Number(settings.practiceSessionSize) || DEFAULT_SESSION_SIZE)));
}

export function needsLearningTopUp(word, now = new Date()) {
  const stats = normalizeWordPracticeStats(word);
  const answeredAt = Date.parse(stats.lastAnsweredAt);
  const dueAt = Date.parse(word.nextReviewDate || word.createdAt);
  if (!Number.isFinite(answeredAt) || now - answeredAt < DAY_MS || stats.lastAnswerCorrect !== true) return false;
  if (!Number.isFinite(dueAt) || dueAt <= now.getTime()) return false;
  // Preserve mature legacy schedules while strengthening newer learning words.
  if (word.mastered || (Number(word.srs?.version || 0) < 3 && Number(word.box) >= 4)) return false;
  return stats.successfulRecallDays + stats.legacySuccessfulReviews < 3;
}

function stableSort(items, score) {
  return [...items].sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
}

export function weaknessScore(word, now = new Date()) {
  const mistakes = normalizeMistakes(word);
  const recentCutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const recent = mistakes.recentFailures.filter(value => Date.parse(value) >= recentCutoff).length;
  return mistakes.consecutiveFailures * 4 + recent * 2 + mistakes.incorrectAttempts * 0.35 + Object.keys(mistakes.confusions).length;
}

export function practicePriorityScore(word, now = new Date()) {
  const dueAt = Date.parse(word?.nextReviewDate || word?.createdAt || 0);
  const overdueDays = Number.isFinite(dueAt) && dueAt <= now.getTime()
    ? Math.min(365, Math.max(0, (now.getTime() - dueAt) / (24 * 60 * 60 * 1000)))
    : 0;
  return wordRecommendationScore(word, { now }) + Math.min(30, overdueDays);
}

export function rankPracticeWords(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const valid = (Array.isArray(words) ? words : []).filter(word => word?.id && word.word && word.definition);
  const ranked = stableSort(valid, word => practicePriorityScore(word, now));
  if (options.uniqueSpellings === false) return ranked;
  const seenSpellings = new Set();
  return ranked.filter(word => {
    const spelling = String(word.word).trim().toLowerCase();
    if (seenSpellings.has(spelling)) return false;
    seenSpellings.add(spelling);
    return true;
  });
}

export function selectPracticeWords(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const limit = Math.max(0, Math.round(options.limit ?? DEFAULT_SESSION_SIZE));
  return selectModeWords(words, {
    mode: 'practice', limit, now, rotateWithinFocus: true,
    priorityShare: 0.5,
    priorityScore: practicePriorityScore
  });
}

export function recommendedExerciseType(word, previousTypes = []) {
  const stage = masteryStage(normalizeMastery(word));
  let available;
  if (stage === 'seen') available = word.imageUrl ? ['image-recognition', 'definition-recognition'] : ['definition-recognition'];
  else if (stage === 'recognized') available = ['typed-recall', 'listening-recall'];
  else if (stage === 'recalled') available = ['context-cloze', 'use-it'];
  else if (stage === 'context') available = ['use-it', 'listening-recall'];
  else available = ['typed-recall', 'context-cloze', 'use-it'];
  const fresh = available.find(type => !previousTypes.includes(type));
  return fresh || available[previousTypes.length % available.length];
}

// Keep the selected words and their order; only assign the requested task mix.
function practiceExercises(selected, words) {
  const visualCandidates = words.length > 1
    ? selected.flatMap((item, index) => item.word.imageUrl ? [index] : []) : [];
  const visualCount = Math.min(Math.round(selected.length * 0.3), visualCandidates.length);
  const visualPositions = new Set(Array.from({ length: visualCount }, (_, index) =>
    visualCandidates[Math.floor((index + 0.5) * visualCandidates.length / visualCount)]));
  return selected.map((item, index) => {
    const exerciseType = visualPositions.has(index) ? 'image-recognition' : 'typed-recall';
    return { id: `${item.word.id}-${index}-${exerciseType}`, wordId: item.word.id,
      exerciseType, source: item.source, immediateRetry: false };
  });
}

function sessionLengthForLibrary(size, target) {
  if (size <= 1) return size;
  if (size < 4) return Math.min(target, size * 2);
  return target;
}

function takeUnique(pool, count, selectedIds) {
  const result = [];
  for (const word of pool) {
    if (result.length >= count) break;
    if (selectedIds.has(word.id)) continue;
    selectedIds.add(word.id);
    result.push(word);
  }
  return result;
}

export function buildDailySession(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const targetSize = Math.max(1, Math.round(options.targetSize || DEFAULT_SESSION_SIZE));
  if (options.kind !== 'weak') {
    const dueWords = getDueWords(words, now);
    const chosen = selectPracticeWords(dueWords, { now, limit: targetSize });
    const spellings = new Set(chosen.map(word => String(word.word).trim().toLowerCase()));
    const topUps = selectPracticeWords((Array.isArray(words) ? words : []).filter(word =>
      needsLearningTopUp(word, now) && !spellings.has(String(word.word).trim().toLowerCase())), {
      now, limit: targetSize - chosen.length
    });
    const dueIds = new Set(dueWords.map(word => word.id));
    const selected = [...chosen, ...topUps].map(word => {
      const stats = normalizeWordPracticeStats(word);
      const source = !dueIds.has(word.id) ? 'growth' : stats.lastAnswerCorrect === false || normalizeMistakes(word).consecutiveFailures > 0
        ? 'weak' : stats.attempts > 0 || word.lastReviewedAt ? 'due' : 'growth';
      return { word, source };
    });
    const exercises = practiceExercises(selected, words);
    const composition = exercises.reduce((counts, exercise) => {
      counts[exercise.source] += 1;
      return counts;
    }, { due: 0, weak: 0, growth: 0 });
    return {
      id: `daily-${now.toISOString().slice(0, 10)}-${selected.length}`,
      createdAt: now.toISOString(), exercises, wordCount: selected.length, composition,
      estimatedMinutes: exercises.length ? Math.max(1, Math.ceil(exercises.length * 32 / 60)) : 0
    };
  }
  const mix = { ...DEFAULT_SESSION_MIX, ...(options.mix || {}) };
  const unique = rankPracticeWords(words, { now });
  if (!unique.length) return { id: `daily-${now.toISOString().slice(0, 10)}`, createdAt: now.toISOString(), exercises: [], composition: { due: 0, weak: 0, growth: 0 }, estimatedMinutes: 0 };

  const sessionSize = sessionLengthForLibrary(unique.length, targetSize);
  const duePool = stableSort(getDueWords(unique, now), word => now - new Date(word.nextReviewDate || word.createdAt));
  const weakPool = stableSort(unique.filter(word => weaknessScore(word, now) > 0), word => weaknessScore(word, now));
  const growthPool = stableSort(unique, word => {
    const stage = masteryStage(normalizeMastery(word, now));
    const stageNeed = { seen: 5, recognized: 4, recalled: 3, context: 2, productive: 1 }[stage];
    const recency = Math.max(0, 30 - (now - new Date(word.createdAt || now)) / (24 * 60 * 60 * 1000));
    return stageNeed * 10 + recency;
  });

  const selectedIds = new Set();
  const selected = [];
  const weakTarget = Math.min(sessionSize, Math.round(sessionSize * mix.weak));
  selected.push(...takeUnique(weakPool, weakTarget, selectedIds).map(word => ({ word, source: 'weak' })));
  const priorityTarget = Math.min(sessionSize, Math.round(sessionSize * (mix.weak + mix.due)));
  selected.push(...takeUnique(duePool, priorityTarget - selected.length, selectedIds).map(word => ({ word, source: 'due' })));
  selected.push(...takeUnique(growthPool, sessionSize - selected.length, selectedIds).map(word => ({ word, source: 'growth' })));
  selected.push(...takeUnique(duePool, sessionSize - selected.length, selectedIds).map(word => ({ word, source: 'due' })));
  selected.push(...takeUnique(weakPool, sessionSize - selected.length, selectedIds).map(word => ({ word, source: 'weak' })));

  // The optional Weak Words mode retains its separate recovery session.
  let cursor = 0;
  while (selected.length < sessionSize && unique.length > 1) {
    const word = growthPool[cursor % growthPool.length];
    cursor += 1;
    if (selected.at(-1)?.word.id === word.id) continue;
    selected.push({ word, source: weaknessScore(word, now) > 0 ? 'weak' : 'growth' });
  }

  const typeHistory = new Map();
  const exercises = selected.map((item, index) => {
    const previousTypes = typeHistory.get(item.word.id) || [];
    const exerciseType = recommendedExerciseType(item.word, previousTypes);
    typeHistory.set(item.word.id, [...previousTypes, exerciseType]);
    return {
      id: `${item.word.id}-${index}-${exerciseType}`,
      wordId: item.word.id,
      exerciseType,
      source: item.source,
      immediateRetry: false
    };
  });
  const composition = exercises.reduce((counts, exercise) => ({ ...counts, [exercise.source]: counts[exercise.source] + 1 }), { due: 0, weak: 0, growth: 0 });
  return {
    id: `daily-${now.toISOString().slice(0, 10)}-${unique.length}`,
    createdAt: now.toISOString(),
    exercises,
    wordCount: new Set(exercises.map(exercise => exercise.wordId)).size,
    composition,
    estimatedMinutes: Math.max(1, Math.ceil(exercises.length * 32 / 60))
  };
}

export function buildWeakWordsSession(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const weak = stableSort((Array.isArray(words) ? words : []).filter(word => weaknessScore(word, now) > 0), word => weaknessScore(word, now));
  return buildDailySession(weak, { ...options, kind: 'weak', now, targetSize: Math.min(options.targetSize || 12, Math.max(1, weak.length * 2)), mix: { due: 0.2, weak: 0.7, growth: 0.1 } });
}

export function hasImmediateDuplicates(exercises) {
  return (Array.isArray(exercises) ? exercises : []).some((exercise, index, items) => index > 0 && exercise.wordId === items[index - 1].wordId && !exercise.immediateRetry);
}
