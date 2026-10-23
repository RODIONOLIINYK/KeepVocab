import { completedExercisesToday } from './learningStats.js?v=18900';
import { getDueWords } from './srsEngine.js?v=18900';
import { masteryStage, normalizeMastery, normalizeMistakes } from './exerciseResult.js?v=18900';
import {
  ensureDailyStudyPlan,
  evaluateDailyStudyPlan,
  isWordReadyForPractice,
  normalizeWordPracticeStats,
  selectModeWords,
  wordRecommendationScore
} from './wordSelection.js?v=18900';

export { ensureDailyStudyPlan, evaluateDailyStudyPlan };

export const DEFAULT_SESSION_SIZE = 20;

export function practiceSessionSize(settings = {}) {
  return Math.max(5, Math.min(50, Math.round(Number(settings.practiceSessionSize) || DEFAULT_SESSION_SIZE)));
}

// Evaluates today's 8:00 AM study plan so completing a word reduces today's remaining
// queue instead of pulling an infinite stream of backlog words into today.
export function buildScheduledPracticeSession(words, settings = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const targetSize = Math.max(1, Math.round(Number(options.targetSize) || practiceSessionSize(settings)));
  const dailyGoal = Math.max(1, Math.min(200, Math.round(Number(settings.dailyGoal) || 20)));
  const dailyPlan = evaluateDailyStudyPlan(words, settings, { now, targetSize });
  const session = buildDailySession(dailyPlan.readyTodayWords, {
    now,
    targetSize: Math.max(1, dailyPlan.readyTodayWords.length || targetSize),
    settings,
    choicePool: words
  });
  return {
    ...session,
    dueWordCount: dailyPlan.remainingTodayCount,
    dailyGoal,
    dailyGoalComplete: dailyPlan.isPlanComplete || completedExercisesToday(settings, now) >= dailyGoal,
    dailyPlan
  };
}

export function needsLearningTopUp(word, now = new Date()) {
  const dueAt = Date.parse(word.nextReviewDate || word.createdAt);
  return Number.isFinite(dueAt) && dueAt > now.getTime()
    && normalizeWordPracticeStats(word).lastAnswerCorrect === true && isWordReadyForPractice(word, now);
}

export function weaknessScore(word, now = new Date()) {
  const mistakes = normalizeMistakes(word);
  const stats = normalizeWordPracticeStats(word);
  const recentCutoff = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const lastCorrectAt = Date.parse(stats.lastCorrectAt || (stats.lastAnswerCorrect === true ? stats.lastAnsweredAt : '')) || 0;
  const recent = mistakes.recentFailures.filter(value => Date.parse(value) >= recentCutoff
    && Date.parse(value) > lastCorrectAt && Date.parse(value) <= now.getTime()).length;
  return mistakes.consecutiveFailures * 4 + stats.consecutiveMisses * 4 + recent * 2;
}

export function practicePriorityScore(word, now = new Date(), settings) {
  const dueAt = Date.parse(word?.nextReviewDate || word?.createdAt || 0);
  const overdueDays = Number.isFinite(dueAt) && dueAt <= now.getTime()
    ? Math.min(365, Math.max(0, (now.getTime() - dueAt) / (24 * 60 * 60 * 1000)))
    : 0;
  return wordRecommendationScore(word, { now, settings }) + Math.min(30, overdueDays);
}

export function selectPracticeWords(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const limit = Math.max(0, Math.round(options.limit ?? DEFAULT_SESSION_SIZE));
  return selectModeWords(words, {
    mode: options.mode || 'practice',
    limit,
    now,
    order: 'priority',
    includeResting: options.includeResting,
    settings: options.settings,
    useDailyPlan: options.useDailyPlan,
    dailyPlan: options.dailyPlan,
    minWords: options.minWords,
    allowCompletedPlanWords: options.allowCompletedPlanWords,
    planSize: options.planSize,
    priorityScore: (word, now) => practicePriorityScore(word, now, options.settings)
  });
}

export function recommendedExerciseType(word) {
  const stage = masteryStage(normalizeMastery(word));
  let available;
  if (stage === 'seen') available = word.imageUrl ? ['image-recognition', 'definition-recognition'] : ['definition-recognition'];
  else if (stage === 'recognized') available = ['typed-recall', 'listening-recall'];
  else if (stage === 'recalled') available = ['context-cloze', 'use-it'];
  else if (stage === 'context') available = ['use-it', 'listening-recall'];
  else available = ['typed-recall', 'context-cloze', 'use-it'];
  return available[0];
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

export function buildDailySession(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const targetSize = Math.max(1, Math.round(options.targetSize || DEFAULT_SESSION_SIZE));
  const weakOnly = options.kind === 'weak';
  const dueWords = getDueWords(words, now);
  const dueWordCount = new Set(dueWords.filter(word => word?.id && word.word && word.definition && isWordReadyForPractice(word, now))
    .map(word => String(word.word).trim().toLowerCase())).size;
  const pool = weakOnly ? (Array.isArray(words) ? words : []).filter(word => weaknessScore(word, now) > 0) : dueWords;
  const chosen = selectPracticeWords(pool, { now, limit: targetSize, mode: weakOnly ? 'weak' : 'practice', settings: options.settings });
  const spellings = new Set(chosen.map(word => String(word.word).trim().toLowerCase()));
  const topUps = weakOnly ? [] : selectPracticeWords((Array.isArray(words) ? words : []).filter(word =>
    needsLearningTopUp(word, now) && !spellings.has(String(word.word).trim().toLowerCase())), {
    now, settings: options.settings, limit: targetSize - chosen.length
  });
  const dueIds = new Set(dueWords.map(word => word.id));
  const selected = [...chosen, ...topUps].map(word => {
    const stats = normalizeWordPracticeStats(word);
    const source = weakOnly ? 'weak' : !dueIds.has(word.id) ? 'growth' : stats.lastAnswerCorrect === false || normalizeMistakes(word).consecutiveFailures > 0
      ? 'weak' : stats.attempts > 0 || word.lastReviewedAt ? 'due' : 'growth';
    return { word, source };
  });
  const choicePool = Array.isArray(options.choicePool) && options.choicePool.length ? options.choicePool : words;
  const hasChoices = new Set((Array.isArray(choicePool) ? choicePool : []).map(word => String(word.word || '').trim().toLowerCase())).size > 1;
  const exercises = weakOnly ? selected.map((item, index) => {
    const recommended = recommendedExerciseType(item.word);
    const exerciseType = !hasChoices && recommended.endsWith('-recognition') ? 'typed-recall' : recommended;
    return { id: `${item.word.id}-${index}-${exerciseType}`, wordId: item.word.id,
      exerciseType, source: 'weak', immediateRetry: false };
  }) : practiceExercises(selected, choicePool);
  const composition = exercises.reduce((counts, exercise) => {
    counts[exercise.source] += 1;
    return counts;
  }, { due: 0, weak: 0, growth: 0 });
  return {
    id: `daily-${now.toISOString().slice(0, 10)}-${selected.length}`,
    createdAt: now.toISOString(), exercises, wordCount: selected.length, dueWordCount, composition,
    estimatedMinutes: exercises.length ? Math.max(1, Math.ceil(exercises.length * 32 / 60)) : 0
  };
}

export function buildWeakWordsSession(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  return buildDailySession(words, { ...options, kind: 'weak', now, targetSize: options.targetSize || 12 });
}
