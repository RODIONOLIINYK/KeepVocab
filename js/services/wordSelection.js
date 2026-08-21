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
  return {
    version: 1,
    attempts,
    recalled,
    missed,
    consecutiveCorrect: count(current.consecutiveCorrect),
    consecutiveMisses: count(current.consecutiveMisses),
    selections: count(current.selections),
    lastSelectedAt: String(current.lastSelectedAt || ''),
    lastAnsweredAt: String(current.lastAnsweredAt || ''),
    lastCorrectAt: String(current.lastCorrectAt || ''),
    lastMissedAt: String(current.lastMissedAt || ''),
    lastAnswerCorrect: current.lastAnswerCorrect === true ? true : current.lastAnswerCorrect === false ? false : null,
    byMode
  };
}

export function updateWordPracticeStats(word, result) {
  const current = normalizeWordPracticeStats(word);
  const exerciseType = String(result.exerciseType || 'unknown');
  const mode = ({ 'context-cloze': 'context', 'ai-speaking': 'speaking' })[exerciseType] || exerciseType;
  const modeStats = normalizeModeStats(current.byMode[mode]);
  const recalled = Boolean(result.correct);
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
  const cutoff = now.getTime() - 14 * DAY_MS;
  return normalizeSelectionMistakes(word).recentFailures.filter(value => validTimestamp(value) >= cutoff).length;
}

export function wordRecommendationScore(word, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const stats = normalizeWordPracticeStats(word);
  const mistakes = normalizeSelectionMistakes(word);
  const mastery = normalizeSelectionMastery(word);
  const dueAt = validTimestamp(word?.nextReviewDate || word?.createdAt);
  const due = dueAt > 0 && dueAt <= now.getTime();
  const errorRate = stats.attempts ? stats.missed / stats.attempts : 0.35;
  const masteryNeed = 1 - Math.max(mastery.recognition, mastery.recall, mastery.context, mastery.productive, mastery.speaking);
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
  const priorityPool = focusPool.length ? focusPool : priorityRanked;
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
