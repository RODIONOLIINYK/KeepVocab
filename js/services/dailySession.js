import { getDueWords } from './srsEngine.js?v=79';
import { masteryStage, normalizeMastery, normalizeMistakes } from './exerciseResult.js?v=79';

export const DEFAULT_SESSION_SIZE = 10;
export const DEFAULT_SESSION_MIX = Object.freeze({ due: 0.35, weak: 0.5, growth: 0.15 });

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
  const limit = Math.max(0, Math.round(options.limit ?? DEFAULT_SESSION_SIZE));
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

  // Small libraries can repeat, but are round-robin so a word is not consecutive.
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
    composition,
    estimatedMinutes: Math.max(1, Math.ceil(exercises.length * 32 / 60))
  };
}

export function buildWeakWordsSession(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const weak = stableSort((Array.isArray(words) ? words : []).filter(word => weaknessScore(word, now) > 0), word => weaknessScore(word, now));
  return buildDailySession(weak, { ...options, now, targetSize: Math.min(options.targetSize || 12, Math.max(1, weak.length * 2)), mix: { due: 0.2, weak: 0.7, growth: 0.1 } });
}

export function hasImmediateDuplicates(exercises) {
  return (Array.isArray(exercises) ? exercises : []).some((exercise, index, items) => index > 0 && exercise.wordId === items[index - 1].wordId && !exercise.immediateRetry);
}
