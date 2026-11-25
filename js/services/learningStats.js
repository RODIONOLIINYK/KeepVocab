import { driveSync } from './driveSync.js?v=18908';
import { applyExerciseToDailyQuests, claimCompletedQuestRewards, normalizeDailyQuestState } from './dailyQuests.js';
import {
  XP_PER_ATTEMPT_EXERCISE,
  XP_PER_CORRECT_EXERCISE,
  XP_STREAK_EXTENDED_BONUS,
  XP_STREAK_MILESTONE_BONUS,
  applyAppTheme,
  getNewUnlocksBetween,
  isBadgeUnlocked,
  isThemeUnlocked,
  normalizeXp,
  resolveEquippedBadge,
  resolveEquippedTheme
} from './xpRewards.js';
import { localDateKey } from '../utils/dates.js';

const MAX_SESSION_HISTORY = 60;

export function completedExercisesToday(settings = {}, now = new Date()) {
  return settings.reviewsDate === localDateKey(now) ? Math.max(0, Number(settings.reviewsToday || 0)) : 0;
}

export function normalizeLearningStats(settings = {}, now = new Date()) {
  const current = settings.learningStats && typeof settings.learningStats === 'object' ? settings.learningStats : {};
  const xp = normalizeXp(current.xp);
  return {
    version: 2,
    totalExercises: Math.max(0, Number(current.totalExercises) || 0),
    correctExercises: Math.max(0, Number(current.correctExercises) || 0),
    sessionsCompleted: Math.max(0, Number(current.sessionsCompleted) || 0),
    weakWordsImproved: Math.max(0, Number(current.weakWordsImproved) || 0),
    productiveUses: Math.max(0, Number(current.productiveUses) || 0),
    speakingMinutes: Math.max(0, Number(current.speakingMinutes) || 0),
    speakingSessions: Math.max(0, Number(current.speakingSessions) || 0),
    xp,
    questsCompletedTotal: Math.max(0, Math.round(Number(current.questsCompletedTotal) || 0)),
    equippedTheme: resolveEquippedTheme(settings.equippedTheme || current.equippedTheme, xp),
    equippedBadge: resolveEquippedBadge(settings.equippedBadge || current.equippedBadge, xp),
    lastStreakBonusDate: String(current.lastStreakBonusDate || ''),
    lastSessionAt: String(current.lastSessionAt || ''),
    sessionHistory: Array.isArray(current.sessionHistory) ? current.sessionHistory.slice(-MAX_SESSION_HISTORY) : [],
    dailyQuests: normalizeDailyQuestState(current.dailyQuests, now)
  };
}

function dispatchRewardEvent(name, detail) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent(name, { detail }));
}

export function recordLearningExercise(result, persistence = driveSync) {
  if (!persistence?.getSettings || !persistence?.updateSettings) return null;
  const settings = persistence.getSettings();
  const now = result.occurredAt ? new Date(result.occurredAt) : new Date();
  const stats = normalizeLearningStats(settings, now);
  const previousXp = stats.xp;

  stats.totalExercises += 1;
  if (result.correct) stats.correctExercises += 1;
  if (result.correct && ['productive', 'speaking'].includes(result.recallType)) stats.productiveUses += 1;

  const exerciseXp = result.correct ? XP_PER_CORRECT_EXERCISE : XP_PER_ATTEMPT_EXERCISE;
  const updatedQuests = applyExerciseToDailyQuests(stats.dailyQuests, result, now);
  const claimed = claimCompletedQuestRewards(updatedQuests, settings, now);
  stats.dailyQuests = claimed.state;
  stats.questsCompletedTotal += claimed.newlyCompleted.length;
  stats.xp = normalizeXp(previousXp + exerciseXp + claimed.xpAwarded);

  persistence.updateSettings({ learningStats: stats }, { silent: true });

  const unlocks = getNewUnlocksBetween(previousXp, stats.xp);
  if (claimed.newlyCompleted.length || claimed.chestBonusAwarded) {
    dispatchRewardEvent('keepvocab:quest-completed', {
      quests: claimed.newlyCompleted,
      chestBonusAwarded: claimed.chestBonusAwarded,
      xpAwarded: claimed.xpAwarded,
      totalXp: stats.xp
    });
  }
  if (unlocks.leveledUp) {
    dispatchRewardEvent('keepvocab:level-up', {
      ...unlocks,
      totalXp: stats.xp
    });
  }
  return { ...stats, exerciseXp, questXp: claimed.xpAwarded, newlyCompletedQuests: claimed.newlyCompleted, chestBonusAwarded: claimed.chestBonusAwarded, unlocks };
}

export function awardStreakXp(detail = {}, persistence = driveSync) {
  if (!persistence?.getSettings || !persistence?.updateSettings) return { xpBonus: 0, leveledUp: false };
  const dateKey = String(detail.date || localDateKey());
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  if (stats.lastStreakBonusDate === dateKey) {
    return { xpBonus: 0, leveledUp: false, totalXp: stats.xp };
  }
  const previousXp = stats.xp;
  const xpBonus = detail.milestone ? XP_STREAK_MILESTONE_BONUS : XP_STREAK_EXTENDED_BONUS;
  stats.xp = normalizeXp(previousXp + xpBonus);
  stats.lastStreakBonusDate = dateKey;
  persistence.updateSettings({ learningStats: stats }, { silent: true });
  const unlocks = getNewUnlocksBetween(previousXp, stats.xp);
  return { xpBonus, totalXp: stats.xp, ...unlocks };
}

export function equipCosmeticReward({ themeId = null, badgeId = null } = {}, persistence = driveSync) {
  if (!persistence?.getSettings || !persistence?.updateSettings) return null;
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  const patch = {};
  if (themeId && isThemeUnlocked(themeId, stats.xp)) {
    stats.equippedTheme = themeId;
    patch.equippedTheme = themeId;
    applyAppTheme(themeId, stats.xp);
  }
  if (badgeId && isBadgeUnlocked(badgeId, stats.xp)) {
    stats.equippedBadge = badgeId;
    patch.equippedBadge = badgeId;
  }
  if (!Object.keys(patch).length) return stats;
  persistence.updateSettings({ ...patch, learningStats: stats });
  return stats;
}

export function recordSessionCompletion(session, summary = {}, persistence = driveSync) {
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  const completedAt = summary.completedAt || new Date().toISOString();
  stats.sessionsCompleted += 1;
  stats.lastSessionAt = completedAt;
  stats.weakWordsImproved += Math.max(0, Number(summary.weakWordsImproved) || 0);
  stats.sessionHistory = [...stats.sessionHistory, {
    id: session.id,
    kind: summary.kind || 'daily',
    completedAt,
    exercises: Math.max(0, Number(summary.exercises) || session.exercises?.length || 0),
    correct: Math.max(0, Number(summary.correct) || 0),
    minutes: Math.max(0, Number(summary.minutes) || 0)
  }].slice(-MAX_SESSION_HISTORY);
  persistence.updateSettings({ learningStats: stats });
  return stats;
}

export function recordSpeakingStats({ minutes = 0, completedAt = new Date().toISOString() } = {}, persistence = driveSync) {
  const settings = persistence.getSettings();
  const stats = normalizeLearningStats(settings);
  const previousXp = stats.xp;
  stats.speakingMinutes += Math.max(0, Number(minutes) || 0);
  stats.speakingSessions += 1;
  stats.xp = normalizeXp(previousXp + 20);
  stats.lastSessionAt = completedAt;
  persistence.updateSettings({ learningStats: stats });
  const unlocks = getNewUnlocksBetween(previousXp, stats.xp);
  if (unlocks.leveledUp) {
    dispatchRewardEvent('keepvocab:level-up', { ...unlocks, totalXp: stats.xp });
  }
  return stats;
}
