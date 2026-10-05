import { localDateKey } from '../utils/dates.js';

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
  const legacyAttempts = count(word?.srs?.repetitions);
  const legacyMissed = count(word?.mistakes?.incorrectAttempts);
  const attempts = hasCurrentStats ? count(current.attempts) : Math.max(legacyAttempts, legacyMissed);
  const missed = hasCurrentStats ? count(current.missed) : Math.min(attempts, legacyMissed);
  const recalled = hasCurrentStats ? count(current.recalled) : Math.max(0, attempts - missed);
  const byMode = current.byMode && typeof current.byMode === 'object'
    ? Object.fromEntries(Object.entries(current.byMode).map(([mode, value]) => [String(mode), normalizeModeStats(value)]))
    : {};
  const lastAnsweredAt = current.lastAnsweredAt || word?.lastExerciseResult?.occurredAt || word?.lastReviewedAt || '';
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
    lastCorrectAt: String(current.lastCorrectAt || ''),
    lastMissedAt: String(current.lastMissedAt || ''),
    lastAnswerCorrect,
    recallAttempts: count(current.recallAttempts),
    unaidedRecalled: count(current.unaidedRecalled),
    successfulRecallDays: count(current.successfulRecallDays),
    lastUnaidedRecallAt: String(current.lastUnaidedRecallAt || ''),
    recognitionCorrect: count(current.recognitionCorrect),
    assistedCorrect: count(current.assistedCorrect),
    hintsUsed: count(current.hintsUsed),
    timedRecallCount: count(current.timedRecallCount),
    recallTimeTotalMs: count(current.recallTimeTotalMs),
    recentResults: Array.isArray(current.recentResults) ? current.recentResults.slice(-20) : [],
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
  const newRecallDay = unaided && (!validTimestamp(current.lastUnaidedRecallAt)
    || localDateKey(new Date(current.lastUnaidedRecallAt)) !== localDateKey(new Date(result.occurredAt)));
  const timedRecall = unaided && Number.isFinite(result.responseTimeMs);
  return {
    ...current,
    attempts: current.attempts + 1,
    recalled: current.recalled + (recalled ? 1 : 0),
    missed: current.missed + (recalled ? 0 : 1),
    consecutiveCorrect: recalled ? current.consecutiveCorrect + 1 : 0,
    consecutiveMisses: recalled ? 0 : current.consecutiveMisses + 1,
    lastAnsweredAt: result.occurredAt,
    lastCorrectAt: recalled ? result.occurredAt : current.lastCorrectAt,
    lastMissedAt: recalled ? current.lastMissedAt : result.occurredAt,
    lastAnswerCorrect: recalled,
    recallAttempts: current.recallAttempts + (recallAttempt ? 1 : 0),
    unaidedRecalled: current.unaidedRecalled + (unaided ? 1 : 0),
    successfulRecallDays: current.successfulRecallDays + (newRecallDay ? 1 : 0),
    lastUnaidedRecallAt: unaided ? result.occurredAt : current.lastUnaidedRecallAt,
    recognitionCorrect: current.recognitionCorrect + (recalled && !recallAttempt ? 1 : 0),
    assistedCorrect: current.assistedCorrect + (recalled && recallAttempt && !unaided ? 1 : 0),
    hintsUsed: current.hintsUsed + count(result.hintsUsed),
    timedRecallCount: current.timedRecallCount + (timedRecall ? 1 : 0),
    recallTimeTotalMs: current.recallTimeTotalMs + (timedRecall ? count(result.responseTimeMs) : 0),
    recentResults: [...current.recentResults, {
      correct: recalled, unaided: Boolean(unaided), recallType: result.recallType,
      hintsUsed: count(result.hintsUsed), responseTimeMs: result.responseTimeMs,
      occurredAt: result.occurredAt
    }].slice(-20),
    byMode: {
      ...current.byMode,
      [mode]: {
        ...modeStats,
        attempts: modeStats.attempts + 1,
        recalled: modeStats.recalled + (recalled ? 1 : 0),
        missed: modeStats.missed + (recalled ? 0 : 1),
        lastAnsweredAt: result.occurredAt
      }
    }
  };
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
  return (due ? 55 : 0)
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
  const limit = Math.max(0, Math.round(options.limit ?? 10));
  const valid = (Array.isArray(words) ? words : []).filter(word => word?.id && word.word && word.definition);
  if (!valid.length || !limit) return [];
  const uniqueSpellings = new Set(valid.map(word => String(word.word).trim().toLowerCase())).size;
  const target = Math.min(limit, uniqueSpellings);
  const externalPriority = typeof options.priorityScore === 'function' ? options.priorityScore : null;
  const priorityScore = word => (externalPriority ? Number(externalPriority(word, now)) || 0 : wordRecommendationScore(word, { now }))
    - recentSelectionPenalty(word, mode, now);
  const priorityRanked = [...valid].sort((a, b) => priorityScore(b) - priorityScore(a)
    || stableDailyTie(a, mode, now) - stableDailyTie(b, mode, now));
  const focusPool = priorityRanked.filter(word => needsPriorityPractice(word, now));
  // A recently answered word may become due before an untouched one. Rank
  // both here so the due flag alone cannot defeat the selection cooldown.
  const priorityPool = priorityRanked;
  const priorityCount = target >= uniqueSpellings
    ? target
    : Math.min(target, Math.max(1, Math.round(target * Math.min(0.5, Math.max(0, Number(options.priorityShare ?? DEFAULT_PRIORITY_SHARE))))));
  const selectedIds = new Set();
  const selectedSpellings = new Set();
  const selected = takeDistinct(priorityPool, priorityCount, selectedIds, selectedSpellings);

  const focusIds = new Set(focusPool.map(word => word.id));
  const rotationRanked = [...valid]
    .filter(word => options.rotateWithinFocus === true || !focusIds.has(word.id))
    .sort(rotationComparator(mode, now, priorityScore));
  selected.push(...takeDistinct(rotationRanked, target - selected.length, selectedIds, selectedSpellings));
  if (selected.length < target) {
    selected.push(...takeDistinct([...valid].sort(rotationComparator(mode, now, priorityScore)), target - selected.length, selectedIds, selectedSpellings));
  }
  return selected.sort((a, b) => stableDailyTie(a, `${mode}-order`, now) - stableDailyTie(b, `${mode}-order`, now));
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
