import { completedExercisesToday } from './learningStats.js?v=18908';
import { getDueWords } from './srsEngine.js?v=18908';
import { masteryStage, normalizeMastery, normalizeMistakes } from './exerciseResult.js?v=18908';
import { canBuildSentenceExercise } from './sentenceBuilder.js';
import {
  ensureDailyStudyPlan,
  evaluateDailyStudyPlan,
  isWordReadyForPractice,
  normalizeWordPracticeStats,
  selectModeWords,
  wordRecommendationScore
} from './wordSelection.js?v=18908';

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
  const hasSentence = canBuildSentenceExercise(word);
  let available;
  if (stage === 'seen') available = word.imageUrl ? ['image-recognition', 'definition-recognition'] : ['definition-recognition'];
  else if (stage === 'recognized') available = ['typed-recall', 'listening-recall', ...(hasSentence ? ['sentence-builder'] : [])];
  else if (stage === 'recalled') available = [...(hasSentence ? ['sentence-builder', 'context-cloze'] : []), 'use-it', 'listening-recall'];
  else if (stage === 'context') available = ['use-it', ...(hasSentence ? ['sentence-builder'] : []), 'listening-recall'];
  else available = ['typed-recall', ...(hasSentence ? ['sentence-builder', 'context-cloze'] : []), 'use-it'];
  return available[0];
}

function normalizeLastMode(word) {
  const raw = String(word?.mastery?.lastExerciseType || word?.lastExerciseResult?.exerciseType || '').toLowerCase();
  return raw.replace(/^daily-/, '');
}

// Keep the selected words and their FSRS urgency order intact while assigning a
// varied, stage-appropriate reinforcement mode to each word (1 word = 1 task).
function practiceExercises(selected, words) {
  const distinctChoiceWords = new Set((Array.isArray(words) ? words : [])
    .map(word => String(word?.word || '').trim().toLowerCase())
    .filter(Boolean)).size;
  const hasChoices = distinctChoiceWords > 1;
  const total = selected.length;
  const maxByMode = {
    'image-recognition': Math.max(1, Math.round(total * 0.25)),
    'sentence-builder': Math.max(1, Math.round(total * 0.3)),
    'context-cloze': Math.max(1, Math.round(total * 0.25)),
    'listening-recall': Math.max(1, Math.round(total * 0.25)),
    'use-it': Math.min(2, Math.max(1, Math.floor(total / 5))),
    'typed-recall': total
  };
  const usedCounts = {};
  const recentModes = [];

  return selected.map((item, index) => {
    const word = item.word;
    const stage = masteryStage(normalizeMastery(word));
    const lastMode = normalizeLastMode(word);
    const afterRecognition = ['recognition', 'assisted'].includes(word.srs?.lastChannel);
    const hasSentence = canBuildSentenceExercise(word);
    const canImage = hasChoices && Boolean(word.imageUrl) && !afterRecognition;
    const canUseIt = ['recalled', 'context', 'productive'].includes(stage) && total >= 3;

    // Stage-driven preference ladder: each FSRS review advances the word across
    // complementary pathways (recognition -> recall/audio -> sentence/context -> production).
    const ladder = stage === 'seen'
      ? [
        ...(canImage ? ['image-recognition'] : []),
        'typed-recall',
        ...(hasSentence ? ['sentence-builder'] : []),
        'listening-recall',
        ...(hasSentence ? ['context-cloze'] : [])
      ]
      : stage === 'recognized'
        ? [
          'typed-recall',
          'listening-recall',
          ...(hasSentence ? ['sentence-builder', 'context-cloze'] : []),
          ...(canImage ? ['image-recognition'] : [])
        ]
        : stage === 'recalled'
          ? [
            ...(hasSentence ? ['sentence-builder', 'context-cloze'] : []),
            'listening-recall',
            ...(canUseIt ? ['use-it'] : []),
            'typed-recall',
            ...(canImage ? ['image-recognition'] : [])
          ]
          : [
            ...(canUseIt ? ['use-it'] : []),
            ...(hasSentence ? ['sentence-builder', 'context-cloze'] : []),
            'listening-recall',
            'typed-recall',
            ...(canImage ? ['image-recognition'] : [])
          ];

    const candidates = [...new Set(ladder.length ? ladder : ['typed-recall'])];
    let bestMode = 'typed-recall';
    let bestScore = -Infinity;

    for (let rank = 0; rank < candidates.length; rank += 1) {
      const mode = candidates[rank];
      const count = usedCounts[mode] || 0;
      if (mode !== 'typed-recall' && count >= (maxByMode[mode] || total)) continue;
      // Single-word libraries should always default to active typed recall unless
      // a stronger contextual mode is explicitly earned.
      if (total === 1 && mode === 'image-recognition') continue;

      let score = 40 - rank * 6;
      // Strongly prefer modes not yet featured in this session for variety.
      if (count === 0) score += 16;
      else score -= count * 5;
      // Avoid repeating the exact same mode this word just saw on its prior review.
      if (lastMode && (lastMode === mode || (lastMode === 'spelling' && mode === 'listening-recall'))) {
        score -= 22;
      }
      // Avoid consecutive runs of the same exercise type inside a session.
      if (recentModes.at(-1) === mode) score -= 18;
      if (recentModes.at(-2) === mode) score -= 6;
      // Encourage sentence-builder, listening-recall, and context-cloze so learners
      // who stay in Practice naturally reinforce words across all key skills.
      if (['sentence-builder', 'context-cloze', 'listening-recall'].includes(mode) && count === 0) {
        score += 6;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMode = mode;
      }
    }

    usedCounts[bestMode] = (usedCounts[bestMode] || 0) + 1;
    recentModes.push(bestMode);
    return {
      id: `${word.id}-${index}-${bestMode}`,
      wordId: word.id,
      exerciseType: bestMode,
      source: item.source,
      immediateRetry: false
    };
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
