import { getDueWords } from './srsEngine.js?v=1602';
import { sentenceUsesTargetForm } from '../utils/wordForms.js?v=1602';
import { masteryStage, normalizeMastery, normalizeMistakes } from './exerciseResult.js?v=1602';

export const DEFAULT_SESSION_WORD_COUNT = 10;
export const DEFAULT_SESSION_SIZE = DEFAULT_SESSION_WORD_COUNT * 2;
export const SESSION_ROUNDS = 2;
export const DEFAULT_SESSION_MIX = Object.freeze({ due: 0.5, weak: 0.35, growth: 0.15 });

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
  const weakness = weaknessScore(word, now);
  const dueAt = Date.parse(word?.nextReviewDate || word?.createdAt || 0);
  const overdueDays = Number.isFinite(dueAt) && dueAt <= now.getTime()
    ? Math.min(365, Math.max(0, (now.getTime() - dueAt) / (24 * 60 * 60 * 1000)))
    : 0;
  const mastery = normalizeMastery(word, now);
  const recallNeed = 1 - Math.max(mastery.recognition, mastery.recall, mastery.context, mastery.productive, mastery.speaking);
  const neverPracticed = mastery.lastPracticedAt ? 0 : 1;
  return weakness * 10_000 + (dueAt <= now.getTime() ? 1_000 : 0) + overdueDays + recallNeed * 100 + neverPracticed * 25;
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
  const limit = Math.max(0, Math.round(options.limit ?? DEFAULT_SESSION_WORD_COUNT));
  return rankPracticeWords(words, options).slice(0, limit);
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

export function workoutExerciseType(word, round, index, { choiceCount = 4, meaningChoiceCount = 4, now = new Date() } = {}) {
  const hasContext = word.example && sentenceUsesTargetForm(word.example, word);
  const practiced = normalizeMastery(word, now).lastExerciseType;
  if (round === 1) {
    const recall = ['typed-recall', 'listening-recall'];
    if (hasContext) recall.push('context-cloze');
    const offset = practiced.includes(recall[index % recall.length]) ? 1 : 0;
    return recall[(index + offset) % recall.length];
  }
  // A single card cannot make a meaningful multiple-choice exercise.
  if (choiceCount < 2) return hasContext ? 'context-cloze' : 'typed-recall';
  const recognition = meaningChoiceCount > 1 ? ['definition-recognition', 'meaning-recognition'] : ['definition-recognition'];
  if (word.imageUrl) recognition.push('image-recognition');
  const offset = practiced.includes(recognition[index % recognition.length]) ? 1 : 0;
  return recognition[(index + offset) % recognition.length];
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
  const mix = { ...DEFAULT_SESSION_MIX, ...(options.mix || {}) };
  const unique = rankPracticeWords(words, { now });
  if (!unique.length) return { id: `daily-${now.toISOString().slice(0, 10)}`, createdAt: now.toISOString(), exercises: [], composition: { due: 0, weak: 0, growth: 0 }, estimatedMinutes: 0 };

  const sessionSize = Math.min(unique.length, Math.max(1, Math.ceil(targetSize / SESSION_ROUNDS)));
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

  // Revisit every selected word in a second round, with other words in between.
  const exercises = [];
  const meaningChoiceCount = new Set(unique.map(word => word.definition.trim().toLowerCase())).size;
  for (let round = 0; round < SESSION_ROUNDS; round += 1) {
    selected.forEach((item, index) => {
      const previousTypes = exercises.filter(exercise => exercise.wordId === item.word.id).map(exercise => exercise.exerciseType);
      let exerciseType = options.includeUseIt
        ? recommendedExerciseType(item.word, previousTypes)
        : workoutExerciseType(item.word, round, index, { choiceCount: unique.length, meaningChoiceCount, now });
      if (previousTypes.includes(exerciseType)) exerciseType = 'listening-recall';
      exercises.push({
        id: `${item.word.id}-${round}-${exerciseType}`,
        wordId: item.word.id,
        exerciseType,
        source: item.source,
        round: round + 1,
        immediateRetry: selected.length === 1 && round > 0
      });
    });
  }
  const composition = selected.reduce((counts, item) => ({ ...counts, [item.source]: counts[item.source] + 1 }), { due: 0, weak: 0, growth: 0 });
  return {
    id: `daily-${now.toISOString().slice(0, 10)}-${unique.length}`,
    createdAt: now.toISOString(),
    exercises,
    wordCount: selected.length,
    rounds: SESSION_ROUNDS,
    composition,
    estimatedMinutes: Math.max(1, Math.ceil(exercises.length * 32 / 60))
  };
}

export function buildWeakWordsSession(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const weak = stableSort((Array.isArray(words) ? words : []).filter(word => weaknessScore(word, now) > 0), word => weaknessScore(word, now));
  return buildDailySession(weak, { ...options, includeUseIt: true, now, targetSize: Math.min(options.targetSize || 12, Math.max(1, weak.length * 2)), mix: { due: 0.2, weak: 0.7, growth: 0.1 } });
}

export function hasImmediateDuplicates(exercises) {
  return (Array.isArray(exercises) ? exercises : []).some((exercise, index, items) => index > 0 && exercise.wordId === items[index - 1].wordId && !exercise.immediateRetry);
}
