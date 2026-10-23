import { readFsrsConfig, rawFsrsRetrievability } from './fsrsConfig.js';
import { memoryContextFeatures, calibratedRecallProbability } from './memoryFeatures.js';
import { DAILY_EVALUATION_HOUR, getNextStudyDayStart, getStudyDayStart, localDateKey, studyDayKey } from '../utils/dates.js';

// Every practice mode uses only the month selected in Library.
export function getActivePracticeWords(persistence) {
  const month = persistence.getActiveNotebook().replace(/ Vocabulary$/, '');
  return persistence.getWordsByMonthYear(month).filter(word => word?.id && word.word && word.definition);
}

export function getScheduledPracticeWords(persistence) {
  // Ignore the retired all-months preference, including settings from old backups.
  return getActivePracticeWords(persistence);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRIORITY_SHARE = 0.3;

function count(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function validTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestTimestamp(...values) {
  const timestamp = Math.max(0, ...values.map(validTimestamp));
  return timestamp ? new Date(timestamp).toISOString() : '';
}

function normalizeModeStats(value) {
  const current = value && typeof value === 'object' ? value : {};
  return {
    selections: count(current.selections),
    attempts: count(current.attempts),
    recalled: count(current.recalled),
    missed: count(current.missed),
    lastSelectedAt: String(current.lastSelectedAt || ''),
    lastAnsweredAt: String(current.lastAnsweredAt || '')
  };
}

function normalizeSelectionMastery(word) {
  const current = word?.mastery && typeof word.mastery === 'object' ? word.mastery : {};
  const safe = value => Math.min(1, Math.max(0, Number(value) || 0));
  return {
    recognition: safe(current.recognition),
    recall: safe(current.recall),
    context: safe(current.context),
    productive: safe(current.productive),
    speaking: safe(current.speaking)
  };
}

function normalizeSelectionMistakes(word) {
  const current = word?.mistakes && typeof word.mistakes === 'object' ? word.mistakes : {};
  return {
    consecutiveFailures: count(current.consecutiveFailures),
    recentFailures: Array.isArray(current.recentFailures) ? current.recentFailures.slice(-20) : []
  };
}

export function normalizeWordPracticeStats(word) {
  const hasCurrentStats = word?.practiceStats && typeof word.practiceStats === 'object';
  const current = hasCurrentStats ? word.practiceStats : {};
  const legacyAttempts = count(word?.srs?.repetitions || (word?.lastReviewedAt ? Math.max(1, count(word.box) - 1) : 0));
  const legacyMissed = count(word?.mistakes?.incorrectAttempts);
  const attempts = hasCurrentStats ? count(current.attempts) : Math.max(legacyAttempts, legacyMissed);
  const missed = hasCurrentStats ? count(current.missed) : Math.min(attempts, legacyMissed);
  const recalled = hasCurrentStats ? count(current.recalled) : Math.max(0, attempts - missed);
  const byMode = current.byMode && typeof current.byMode === 'object'
    ? Object.fromEntries(Object.entries(current.byMode).map(([mode, value]) => [String(mode), normalizeModeStats(value)]))
    : {};
  const lastResult = word?.lastExerciseResult;
  const recentResults = Array.isArray(current.recentResults) ? current.recentResults.slice(-20) : [];
  const lastAnsweredAt = latestTimestamp(current.lastAnsweredAt, lastResult?.occurredAt, word?.lastReviewedAt);
  // Recognition and hinted answers cannot stand in for successful retrieval.
  // Recover timestamps only from records which explicitly stored that evidence.
  const lastResultUnaided = lastResult?.correct && lastResult.producedUnaided && !lastResult.hintsUsed
    && lastResult.recallType && lastResult.recallType !== 'recognition';
  const lastUnaidedRecallAt = latestTimestamp(current.lastUnaidedRecallAt,
    lastResultUnaided ? lastResult.occurredAt : '',
    ...recentResults.filter(result => result.correct && result.unaided && result.recallType !== 'recognition').map(result => result.occurredAt));
  const lastAnswerCorrect = typeof current.lastAnswerCorrect === 'boolean' ? current.lastAnswerCorrect
    : typeof word?.lastExerciseResult?.correct === 'boolean' ? word.lastExerciseResult.correct
      : word?.srs?.lastRating ? word.srs.lastRating !== 'again' : null;
  return {
    version: 2,
    attempts,
    recalled,
    missed,
    // Old records did not distinguish recall from recognition. Keep their
    // successful-review baseline without inventing independent recall days.
    legacySuccessfulReviews: Number(current.version) >= 2 ? count(current.legacySuccessfulReviews) : recalled,
    consecutiveCorrect: count(current.consecutiveCorrect),
    consecutiveMisses: count(current.consecutiveMisses),
    selections: count(current.selections),
    lastSelectedAt: String(current.lastSelectedAt || ''),
    lastAnsweredAt: String(lastAnsweredAt),
    lastCorrectAt: latestTimestamp(current.lastCorrectAt, lastResult?.correct ? lastResult.occurredAt : ''),
    lastMissedAt: latestTimestamp(current.lastMissedAt, lastResult?.correct === false ? lastResult.occurredAt : ''),
    lastAnswerCorrect,
    recallAttempts: count(current.recallAttempts),
    unaidedRecalled: count(current.unaidedRecalled),
    successfulRecallDays: count(current.successfulRecallDays),
    lastUnaidedRecallAt,
    recognitionCorrect: count(current.recognitionCorrect),
    assistedCorrect: count(current.assistedCorrect),
    hintsUsed: count(current.hintsUsed),
    timedRecallCount: count(current.timedRecallCount),
    recallTimeTotalMs: count(current.recallTimeTotalMs),
    recentResults,
    byMode
  };
}

export function updateWordPracticeStats(word, result) {
  const current = normalizeWordPracticeStats(word);
  const exerciseType = String(result.exerciseType || 'unknown');
  const mode = ({ 'context-cloze': 'context', 'ai-speaking': 'speaking',
    'daily-typed-recall': 'practice', 'daily-image-recognition': 'practice' })[exerciseType] || exerciseType;
  const modeStats = normalizeModeStats(current.byMode[mode]);
  const recalled = Boolean(result.correct);
  const recallAttempt = result.recallType !== 'recognition';
  const unaided = recalled && recallAttempt && result.producedUnaided && !result.hintsUsed;
  const latestAnswer = validTimestamp(result.occurredAt) >= validTimestamp(current.lastAnsweredAt);
  const newRecallDay = unaided && (!validTimestamp(current.lastUnaidedRecallAt)
    || localDateKey(new Date(current.lastUnaidedRecallAt)) < localDateKey(new Date(result.occurredAt)));
  const timedRecall = unaided && Number.isFinite(result.responseTimeMs);
  return {
    ...current,
    attempts: current.attempts + 1,
    recalled: current.recalled + (recalled ? 1 : 0),
    missed: current.missed + (recalled ? 0 : 1),
    consecutiveCorrect: latestAnswer ? (recalled ? current.consecutiveCorrect + 1 : 0) : current.consecutiveCorrect,
    consecutiveMisses: latestAnswer ? (recalled ? 0 : current.consecutiveMisses + 1) : current.consecutiveMisses,
    lastAnsweredAt: latestTimestamp(current.lastAnsweredAt, result.occurredAt),
    lastCorrectAt: recalled ? latestTimestamp(current.lastCorrectAt, result.occurredAt) : current.lastCorrectAt,
    lastMissedAt: recalled ? current.lastMissedAt : latestTimestamp(current.lastMissedAt, result.occurredAt),
    lastAnswerCorrect: latestAnswer ? recalled : current.lastAnswerCorrect,
    recallAttempts: current.recallAttempts + (recallAttempt ? 1 : 0),
    unaidedRecalled: current.unaidedRecalled + (unaided ? 1 : 0),
    successfulRecallDays: current.successfulRecallDays + (newRecallDay ? 1 : 0),
    lastUnaidedRecallAt: unaided ? latestTimestamp(current.lastUnaidedRecallAt, result.occurredAt) : current.lastUnaidedRecallAt,
    recognitionCorrect: current.recognitionCorrect + (recalled && !recallAttempt ? 1 : 0),
    assistedCorrect: current.assistedCorrect + (recalled && recallAttempt && !unaided ? 1 : 0),
    hintsUsed: current.hintsUsed + count(result.hintsUsed),
    timedRecallCount: current.timedRecallCount + (timedRecall ? 1 : 0),
    recallTimeTotalMs: current.recallTimeTotalMs + (timedRecall ? count(result.responseTimeMs) : 0),
    recentResults: [...current.recentResults, {
      correct: recalled, unaided: Boolean(unaided), recallType: result.recallType,
      hintsUsed: count(result.hintsUsed), responseTimeMs: result.responseTimeMs,
      occurredAt: result.occurredAt
    }].sort((left, right) => validTimestamp(left.occurredAt) - validTimestamp(right.occurredAt)).slice(-20),
    byMode: {
      ...current.byMode,
      [mode]: {
        ...modeStats,
        attempts: modeStats.attempts + 1,
        recalled: modeStats.recalled + (recalled ? 1 : 0),
        missed: modeStats.missed + (recalled ? 0 : 1),
        lastAnsweredAt: latestTimestamp(modeStats.lastAnsweredAt, result.occurredAt)
      }
    }
  };
}

// Automatic modes share review cooldowns. Explicitly chosen words may opt out
// through includeResting, without changing their saved review dates.
export function isWordReadyForPractice(word, now = new Date()) {
  const stats = normalizeWordPracticeStats(word);
  const timestamp = now.getTime();
  const answeredAt = validTimestamp(stats.lastAnsweredAt);
  const dueAt = validTimestamp(word?.nextReviewDate || word?.createdAt);
  const recallAt = validTimestamp(stats.lastUnaidedRecallAt);
  const recallDays = stats.successfulRecallDays + stats.legacySuccessfulReviews;
  const reliable = recallDays >= 3 && stats.lastAnswerCorrect !== false
    && !stats.consecutiveMisses && !normalizeSelectionMistakes(word).consecutiveFailures;
  if (word?.srs?.algorithm === 'FSRS-6') {
    if (stats.lastAnswerCorrect === true && answeredAt && dueAt <= answeredAt && timestamp - answeredAt < 10 * 60 * 1000) {
      return false;
    }
    return Boolean(dueAt && dueAt <= timestamp);
  }
  if (dueAt && dueAt <= timestamp) {
    return !(reliable && recallAt && timestamp - recallAt < DAY_MS);
  }
  if (!answeredAt && !stats.attempts) return !dueAt;
  if (stats.lastAnswerCorrect !== true || !answeredAt || timestamp - answeredAt < DAY_MS) return false;
  // Mature legacy schedules are retained until their actual review date.
  if (word.mastered || (Number(word.srs?.version || 0) < 3 && Number(word.box) >= 4)) return false;
  return recallDays < 3;
}

function recentFailureCount(word, now) {
  const stats = normalizeWordPracticeStats(word);
  // A successful answer resolves earlier failures; lifetime misses should not
  // permanently pin a recovered word to the front of every session.
  const lastCorrectAt = validTimestamp(stats.lastCorrectAt || (stats.lastAnswerCorrect === true ? stats.lastAnsweredAt : ''));
  const cutoff = Math.max(now.getTime() - 14 * DAY_MS, lastCorrectAt);
  return normalizeSelectionMistakes(word).recentFailures.filter(value => validTimestamp(value) > cutoff && validTimestamp(value) <= now.getTime()).length;
}

export function wordRecommendationScore(word, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const stats = normalizeWordPracticeStats(word);
  const mistakes = normalizeSelectionMistakes(word);
  const mastery = normalizeSelectionMastery(word);
  const dueAt = validTimestamp(word?.nextReviewDate || word?.createdAt);
  const due = dueAt > 0 && dueAt <= now.getTime();
  const errorRate = stats.attempts ? stats.missed / stats.attempts * Math.pow(0.5, stats.consecutiveCorrect) : 0.35;
  const masteryNeed = 1 - Math.max(mastery.recall, mastery.context, mastery.productive, mastery.speaking);
  const recallNeed = Math.max(0, 3 - stats.successfulRecallDays - stats.legacySuccessfulReviews) / 3;
  const recent = stats.recentResults.slice(-8);
  const recentErrorRate = recent.length ? recent.filter(result => !result.correct).length / recent.length : errorRate;
  const slowRecall = stats.timedRecallCount ? Math.min(1, stats.recallTimeTotalMs / stats.timedRecallCount / 30000) : 0;
  const daysSinceAnswer = stats.lastAnsweredAt
    ? Math.max(0, (now.getTime() - validTimestamp(stats.lastAnsweredAt)) / DAY_MS)
    : 30;
  const recentCorrectPenalty = stats.lastAnswerCorrect === true && daysSinceAnswer < 3
    ? (3 - daysSinceAnswer) * 18 + Math.min(30, stats.consecutiveCorrect * 6)
    : 0;
  const config = readFsrsConfig(options.settings);
  const rawRecall = rawFsrsRetrievability(word, now, config);
  const recall = rawRecall === null ? null : calibratedRecallProbability(rawRecall, memoryContextFeatures(word, now, { stats }), config.models.recall?.calibration);
  return (recall === null ? 0 : (1 - recall) * 90) + (due ? 55 : 0)
    + recentFailureCount(word, now) * 7
    + mistakes.consecutiveFailures * 18
    + stats.consecutiveMisses * 12
    + errorRate * 32
    + recentErrorRate * 20
    + recallNeed * 24
    + slowRecall * 8
    + masteryNeed * 18
    - recentCorrectPenalty;
}

function planUrgencyScore(word, now, settings) {
  const dueAt = validTimestamp(word?.nextReviewDate || word?.createdAt);
  const overdueDays = dueAt && dueAt <= now.getTime()
    ? Math.min(365, Math.max(0, (now.getTime() - dueAt) / DAY_MS))
    : 0;
  return wordRecommendationScore(word, { now, settings }) + Math.min(30, overdueDays);
}

function classifyStudyPlanWord(word, dayStartMs, nowMs) {
  const stats = normalizeWordPracticeStats(word);
  const answeredAt = validTimestamp(stats.lastAnsweredAt);
  const answeredToday = answeredAt >= dayStartMs && answeredAt <= nowMs;
  const completedToday = answeredToday && stats.lastAnswerCorrect === true;
  const missedToday = answeredToday && stats.lastAnswerCorrect === false;
  const resultsToday = stats.recentResults.filter(result => {
    const t = validTimestamp(result.occurredAt);
    return t >= dayStartMs && t <= nowMs;
  }).length;
  const priorAttempts = Math.max(0, stats.attempts - (resultsToday || (answeredToday ? 1 : 0)));
  const hadPriorHistory = priorAttempts > 0
    || (Boolean(word.lastReviewedAt) && validTimestamp(word.lastReviewedAt) < dayStartMs)
    || (!answeredToday && count(word.box) > 1);
  return {
    word,
    stats,
    answeredAt,
    answeredToday,
    completedToday,
    missedToday,
    hadPriorHistory,
    dueAt: validTimestamp(word?.nextReviewDate || word?.createdAt)
  };
}

// Evaluates the active month's vocabulary at the 8:00 AM study day boundary
// into three buckets: reviseToday, learnToday, and reviseTomorrow.
export function evaluateDailyStudyPlan(words, settings = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const evaluationHour = Number.isFinite(Number(options.evaluationHour))
    ? Number(options.evaluationHour)
    : DAILY_EVALUATION_HOUR;
  const dayStart = getStudyDayStart(now, evaluationHour);
  const nextDayStart = getNextStudyDayStart(now, evaluationHour);
  const tomorrowEnd = new Date(nextDayStart.getTime() + DAY_MS);
  const dayKey = studyDayKey(now, evaluationHour);
  const dayStartMs = dayStart.getTime();
  const nowMs = now.getTime();
  const tomorrowEndMs = tomorrowEnd.getTime();
  const configuredSize = Math.max(5, Math.min(50, Math.round(Number(settings?.practiceSessionSize) || 20)));
  const planSize = Math.max(1, Math.round(Number(options.targetSize) || configuredSize));

  const valid = (Array.isArray(words) ? words : []).filter(word => word?.id && word.word && word.definition);
  const scores = new Map(valid.map(word => [word.id, planUrgencyScore(word, now, settings)]));
  const compareUrgency = (left, right) => {
    const leftInfo = classifyStudyPlanWord(left, dayStartMs, nowMs);
    const rightInfo = classifyStudyPlanWord(right, dayStartMs, nowMs);
    const leftActive = leftInfo.answeredToday || isWordReadyForPractice(left, now) ? 0 : 1;
    const rightActive = rightInfo.answeredToday || isWordReadyForPractice(right, now) ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    const leftDue = leftInfo.dueAt <= nowMs ? 0 : 1;
    const rightDue = rightInfo.dueAt <= nowMs ? 0 : 1;
    if (leftDue !== rightDue) return leftDue - rightDue;
    const scoreDiff = (scores.get(right.id) || 0) - (scores.get(left.id) || 0);
    if (scoreDiff) return scoreDiff;
    if (leftInfo.dueAt !== rightInfo.dueAt) return leftInfo.dueAt - rightInfo.dueAt;
    if (leftInfo.answeredAt !== rightInfo.answeredAt) return leftInfo.answeredAt - rightInfo.answeredAt;
    return String(left.id).localeCompare(String(right.id));
  };

  const rankedValid = [...valid].sort(compareUrgency);
  const distinctWords = [];
  const seenSpellings = new Set();
  for (const word of rankedValid) {
    const spelling = String(word.word).trim().toLowerCase();
    if (!spelling || seenSpellings.has(spelling)) continue;
    seenSpellings.add(spelling);
    distinctWords.push(word);
  }

  const infoById = new Map(distinctWords.map(word => [String(word.id), classifyStudyPlanWord(word, dayStartMs, nowMs)]));
  const wordById = new Map(distinctWords.map(word => [String(word.id), word]));
  const saved = !options.ignoreSavedPlan && settings?.dailyStudyPlan && typeof settings.dailyStudyPlan === 'object'
    ? settings.dailyStudyPlan
    : null;
  const savedMatches = Boolean(saved
    && saved.dayKey === dayKey
    && (!settings?.activeNotebook || !saved.notebook || saved.notebook === settings.activeNotebook)
    && Number(saved.planSize) === planSize
    && (Array.isArray(saved.reviseIds) || Array.isArray(saved.learnIds)));

  let plannedReviseIds = [];
  let plannedLearnIds = [];

  if (savedMatches) {
    const rawRevise = (saved.reviseIds || []).map(String).filter(id => wordById.has(id));
    const rawLearn = (saved.learnIds || []).map(String).filter(id => wordById.has(id) && !rawRevise.includes(id));
    if (rawRevise.length || rawLearn.length || !distinctWords.length) {
      plannedReviseIds = [...rawRevise];
      plannedLearnIds = [...rawLearn];
      const lockedSet = new Set([...plannedReviseIds, ...plannedLearnIds]);
      for (const word of distinctWords) {
        const id = String(word.id);
        if (lockedSet.has(id)) continue;
        const info = infoById.get(id);
        if (!info.answeredToday) continue;
        if (lockedSet.size >= planSize) {
          const dropFromLearn = [...plannedLearnIds].reverse().find(candidateId => !infoById.get(candidateId)?.answeredToday);
          const dropFromRevise = [...plannedReviseIds].reverse().find(candidateId => !infoById.get(candidateId)?.answeredToday);
          const dropId = dropFromLearn || dropFromRevise;
          if (dropId) {
            lockedSet.delete(dropId);
            plannedLearnIds = plannedLearnIds.filter(item => item !== dropId);
            plannedReviseIds = plannedReviseIds.filter(item => item !== dropId);
          }
        }
        if (lockedSet.size < planSize) {
          lockedSet.add(id);
          if (info.hadPriorHistory || info.missedToday) plannedReviseIds.push(id);
          else plannedLearnIds.push(id);
        }
      }
      if (lockedSet.size < planSize) {
        for (const word of distinctWords) {
          if (lockedSet.size >= planSize) break;
          const id = String(word.id);
          if (lockedSet.has(id)) continue;
          const info = infoById.get(id);
          const addedAfterEvaluation = validTimestamp(word.createdAt) >= dayStartMs;
          if (addedAfterEvaluation && isWordReadyForPractice(word, now)) {
            lockedSet.add(id);
            if (info.hadPriorHistory || info.missedToday) plannedReviseIds.push(id);
            else plannedLearnIds.push(id);
          }
        }
      }
    }
  }

  if (!plannedReviseIds.length && !plannedLearnIds.length && distinctWords.length) {
    const practicedToday = distinctWords.filter(word => infoById.get(String(word.id)).answeredToday).slice(0, planSize);
    const practicedIds = new Set(practicedToday.map(word => String(word.id)));
    const remainingSlots = Math.max(0, planSize - practicedToday.length);
    const unpracticedReady = distinctWords.filter(word => {
      const id = String(word.id);
      return !practicedIds.has(id) && isWordReadyForPractice(word, now);
    });
    const reviseCandidates = unpracticedReady.filter(word => infoById.get(String(word.id)).hadPriorHistory);
    const learnCandidates = unpracticedReady.filter(word => !infoById.get(String(word.id)).hadPriorHistory);

    let reviseQuota = 0;
    let learnQuota = 0;
    if (reviseCandidates.length > 0 && learnCandidates.length > 0) {
      const targetLearnTotal = Math.min(planSize, Math.max(1, Math.round(planSize * 0.3)));
      const practicedNewCount = practicedToday.filter(word => !infoById.get(String(word.id)).hadPriorHistory).length;
      learnQuota = Math.min(learnCandidates.length, Math.max(0, Math.min(remainingSlots, targetLearnTotal - practicedNewCount)));
      reviseQuota = Math.min(reviseCandidates.length, Math.max(0, remainingSlots - learnQuota));
      if (reviseQuota + learnQuota < remainingSlots) {
        reviseQuota = Math.min(reviseCandidates.length, remainingSlots - learnQuota);
        learnQuota = Math.min(learnCandidates.length, remainingSlots - reviseQuota);
      }
    } else if (reviseCandidates.length === 0) {
      learnQuota = Math.min(learnCandidates.length, remainingSlots);
    } else {
      reviseQuota = Math.min(reviseCandidates.length, remainingSlots);
    }

    for (const word of practicedToday) {
      const id = String(word.id);
      const info = infoById.get(id);
      if (info.hadPriorHistory) plannedReviseIds.push(id);
      else plannedLearnIds.push(id);
    }
    for (const word of reviseCandidates.slice(0, reviseQuota)) plannedReviseIds.push(String(word.id));
    for (const word of learnCandidates.slice(0, learnQuota)) plannedLearnIds.push(String(word.id));
  }

  const allPlannedIds = [...plannedReviseIds, ...plannedLearnIds];
  const plannedIdSet = new Set(allPlannedIds);
  const initialReviseSet = new Set(plannedReviseIds);

  const reviseToday = [];
  const learnToday = [];
  const completedToday = [];

  for (const id of allPlannedIds) {
    const word = wordById.get(id);
    const info = infoById.get(id);
    if (!word || !info) continue;
    if (info.completedToday) {
      completedToday.push(word);
    } else if (initialReviseSet.has(id) || info.missedToday || info.hadPriorHistory) {
      reviseToday.push(word);
    } else {
      learnToday.push(word);
    }
  }

  const todayWords = [...reviseToday, ...learnToday].sort(compareUrgency);
  const readyTodayWords = todayWords.filter(word => isWordReadyForPractice(word, now));

  const reviseTomorrow = [];
  const tomorrowSeen = new Set();
  const addTomorrowWord = word => {
    const id = String(word.id);
    if (tomorrowSeen.has(id)) return;
    tomorrowSeen.add(id);
    reviseTomorrow.push(word);
  };

  for (const word of completedToday) {
    const info = infoById.get(String(word.id));
    if (!info?.dueAt || info.dueAt <= tomorrowEndMs) addTomorrowWord(word);
  }
  for (const word of distinctWords) {
    const id = String(word.id);
    if (plannedIdSet.has(id)) continue;
    const info = infoById.get(id);
    if (isWordReadyForPractice(word, now) || (info.dueAt > 0 && info.dueAt <= tomorrowEndMs)) {
      addTomorrowWord(word);
    }
  }

  return {
    dayKey,
    evaluationHour,
    evaluatedAt: dayStart.toISOString(),
    nextEvaluationAt: nextDayStart.toISOString(),
    planSize,
    reviseToday,
    learnToday,
    completedToday,
    reviseTomorrow,
    todayWords,
    readyTodayWords,
    allPlannedTodayWords: [...todayWords, ...completedToday],
    reviseTodayCount: reviseToday.length,
    learnTodayCount: learnToday.length,
    completedTodayCount: completedToday.length,
    reviseTomorrowCount: reviseTomorrow.length,
    plannedTodayCount: allPlannedIds.length,
    remainingTodayCount: todayWords.length,
    readyTodayCount: readyTodayWords.length,
    isPlanComplete: allPlannedIds.length > 0 && todayWords.length === 0,
    snapshot: {
      dayKey,
      notebook: String(settings?.activeNotebook || ''),
      evaluatedAt: dayStart.toISOString(),
      nextEvaluationAt: nextDayStart.toISOString(),
      planSize,
      reviseIds: plannedReviseIds,
      learnIds: plannedLearnIds
    }
  };
}

export function ensureDailyStudyPlan(persistence, options = {}) {
  if (!persistence || typeof persistence.getSettings !== 'function') return {};
  const settings = persistence.getSettings();
  const words = getScheduledPracticeWords(persistence);
  const plan = evaluateDailyStudyPlan(words, settings, options);
  const current = settings.dailyStudyPlan;
  const needsSave = !current
    || current.dayKey !== plan.snapshot.dayKey
    || current.notebook !== plan.snapshot.notebook
    || Number(current.planSize) !== plan.snapshot.planSize
    || (current.reviseIds?.length || 0) + (current.learnIds?.length || 0) !== plan.snapshot.reviseIds.length + plan.snapshot.learnIds.length;
  if (needsSave && typeof persistence.updateSettings === 'function') {
    persistence.updateSettings({ dailyStudyPlan: plan.snapshot });
    return persistence.getSettings();
  }
  return settings;
}

function needsPriorityPractice(word, now) {
  const stats = normalizeWordPracticeStats(word);
  const mistakes = normalizeSelectionMistakes(word);
  const dueAt = validTimestamp(word?.nextReviewDate || word?.createdAt);
  return (dueAt > 0 && dueAt <= now.getTime())
    || stats.lastAnswerCorrect === false
    || stats.consecutiveMisses > 0
    || mistakes.consecutiveFailures > 0
    || recentFailureCount(word, now) > 0;
}

function stableDailyTie(word, mode, now) {
  const input = `${now.toISOString().slice(0, 10)}|${mode}|${word.id}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function recentSelectionPenalty(word, mode, now) {
  const stats = normalizeWordPracticeStats(word);
  const modeStats = normalizeModeStats(stats.byMode[mode]);
  const modeAgeDays = modeStats.lastSelectedAt ? (now.getTime() - validTimestamp(modeStats.lastSelectedAt)) / DAY_MS : 30;
  const globalAgeDays = stats.lastSelectedAt ? (now.getTime() - validTimestamp(stats.lastSelectedAt)) / DAY_MS : 30;
  return Math.max(0, 4 - modeAgeDays) * 22 + Math.max(0, 1.5 - globalAgeDays) * 16;
}

function rotationComparator(mode, now, priorityScore) {
  return (left, right) => {
    const leftStats = normalizeWordPracticeStats(left);
    const rightStats = normalizeWordPracticeStats(right);
    const leftMode = normalizeModeStats(leftStats.byMode[mode]);
    const rightMode = normalizeModeStats(rightStats.byMode[mode]);
    const leftNever = leftMode.lastSelectedAt ? 0 : 1;
    const rightNever = rightMode.lastSelectedAt ? 0 : 1;
    if (leftNever !== rightNever) return rightNever - leftNever;
    const leftSelected = validTimestamp(leftMode.lastSelectedAt);
    const rightSelected = validTimestamp(rightMode.lastSelectedAt);
    if (leftSelected !== rightSelected) return leftSelected - rightSelected;
    if (leftMode.selections !== rightMode.selections) return leftMode.selections - rightMode.selections;
    if (leftStats.selections !== rightStats.selections) return leftStats.selections - rightStats.selections;
    const needDifference = priorityScore(right) - priorityScore(left);
    if (needDifference) return needDifference;
    return stableDailyTie(left, mode, now) - stableDailyTie(right, mode, now);
  };
}

function takeDistinct(pool, count, selectedIds, selectedSpellings) {
  const result = [];
  for (const word of pool) {
    if (result.length >= count) break;
    const spelling = String(word.word).trim().toLowerCase();
    if (selectedIds.has(word.id) || selectedSpellings.has(spelling)) continue;
    selectedIds.add(word.id);
    selectedSpellings.add(spelling);
    result.push(word);
  }
  return result;
}

export function selectModeWords(words, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const mode = String(options.mode || 'independent');
  const settings = options.settings || readFsrsConfig();
  const limit = Math.max(0, Math.round(options.limit ?? 10));
  if (!limit) return [];

  if (options.useDailyPlan || options.dailyPlan) {
    const plan = options.dailyPlan && typeof options.dailyPlan === 'object'
      ? options.dailyPlan
      : evaluateDailyStudyPlan(words, settings, { now, targetSize: options.planSize });
    const primary = selectModeWords(plan.readyTodayWords, {
      ...options,
      useDailyPlan: false,
      dailyPlan: null,
      limit
    });
    const minWords = Math.max(0, Math.round(Number(options.minWords) || 0));
    const shouldTopUpCompleted = primary.length < limit && (
      options.allowCompletedPlanWords === true
      || (primary.length > 0 && primary.length < minWords)
    );
    if (shouldTopUpCompleted && plan.completedToday.length > 0) {
      const chosenIds = new Set(primary.map(word => word.id));
      const chosenSpellings = new Set(primary.map(word => String(word.word).trim().toLowerCase()));
      const completedPool = plan.completedToday.filter(word => !chosenIds.has(word.id)
        && !chosenSpellings.has(String(word.word).trim().toLowerCase()));
      const topUpTarget = options.allowCompletedPlanWords === true ? limit - primary.length : minWords - primary.length;
      const topUp = selectModeWords(completedPool, {
        ...options,
        useDailyPlan: false,
        dailyPlan: null,
        includeResting: true,
        limit: Math.max(0, topUpTarget)
      });
      return [...primary, ...topUp];
    }
    return primary;
  }

  const valid = (Array.isArray(words) ? words : []).filter(word => word?.id && word.word && word.definition
    && (options.includeResting === true || isWordReadyForPractice(word, now)));
  if (!valid.length) return [];
  const uniqueSpellings = new Set(valid.map(word => String(word.word).trim().toLowerCase())).size;
  const target = Math.min(limit, uniqueSpellings);
  const externalPriority = typeof options.priorityScore === 'function' ? options.priorityScore : null;
  const scores = new Map(valid.map(word => [word, (externalPriority ? Number(externalPriority(word, now)) || 0 : wordRecommendationScore(word, { now, settings }))
    - recentSelectionPenalty(word, mode, now)]));
  const priorityScore = word => scores.get(word);
  const dueAt = word => validTimestamp(word.nextReviewDate || word.createdAt);
  const comparePriority = (a, b) => priorityScore(b) - priorityScore(a)
    || dueAt(a) - dueAt(b)
    || validTimestamp(normalizeWordPracticeStats(a).lastAnsweredAt) - validTimestamp(normalizeWordPracticeStats(b).lastAnsweredAt)
    || String(a.id).localeCompare(String(b.id));
  const priorityRanked = [...valid].sort(comparePriority);
  const selectedIds = new Set();
  const selectedSpellings = new Set();
  if (options.order === 'priority') {
    // Review queues use the whole urgency ranking, rather than a priority
    // sample followed by rotation. Early learning / manual overrides follow
    // actual due reviews, and the displayed order is the selection order.
    priorityRanked.sort((a, b) => Number(dueAt(a) > now.getTime()) - Number(dueAt(b) > now.getTime())
      || comparePriority(a, b));
    return takeDistinct(priorityRanked, target, selectedIds, selectedSpellings);
  }
  const focusPool = priorityRanked.filter(word => needsPriorityPractice(word, now));
  // A recently answered word may become due before an untouched one. Rank
  // both here so the due flag alone cannot defeat the selection cooldown.
  const priorityPool = priorityRanked;
  const priorityCount = target >= uniqueSpellings
    ? target
    : Math.min(target, Math.max(1, Math.round(target * Math.min(0.5, Math.max(0, Number(options.priorityShare ?? DEFAULT_PRIORITY_SHARE))))));
  const selected = takeDistinct(priorityPool, priorityCount, selectedIds, selectedSpellings);

  const focusIds = new Set(focusPool.map(word => word.id));
  const rotationRanked = [...valid]
    .filter(word => options.rotateWithinFocus === true || !focusIds.has(word.id))
    .sort(rotationComparator(mode, now, priorityScore));
  selected.push(...takeDistinct(rotationRanked, target - selected.length, selectedIds, selectedSpellings));
  if (selected.length < target) {
    selected.push(...takeDistinct([...valid].sort(rotationComparator(mode, now, priorityScore)), target - selected.length, selectedIds, selectedSpellings));
  }
  return selected.sort(comparePriority);
}

export function applyModeSelectionToWord(word, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const mode = String(options.mode || 'independent');
  const occurredAt = now.toISOString();
  const current = normalizeWordPracticeStats(word);
  const modeStats = normalizeModeStats(current.byMode[mode]);
  return {
    ...word,
    updatedAt: occurredAt,
    practiceStats: {
      ...current,
      selections: current.selections + 1,
      lastSelectedAt: occurredAt,
      byMode: {
        ...current.byMode,
        [mode]: {
          ...modeStats,
          selections: modeStats.selections + 1,
          lastSelectedAt: occurredAt
        }
      }
    }
  };
}

export function recordModeWordSelections(persistence, selectedWords, options = {}) {
  const selectedIds = new Set((selectedWords || []).map(word => String(word.id)));
  if (!selectedIds.size) return [];
  const words = persistence.getWords();
  const updated = words.map(word => selectedIds.has(String(word.id)) ? applyModeSelectionToWord(word, options) : word);
  persistence.saveWords(updated);
  return updated.filter(word => selectedIds.has(String(word.id)));
}
