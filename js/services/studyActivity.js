import { localDateKey } from '../utils/dates.js';

export const MAX_STREAK_FREEZES = 2;
export const STREAK_MILESTONES = Object.freeze([3, 7, 14, 21, 30, 50, 75, 100, 180, 365]);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function localNoon(date = new Date()) {
  const source = date instanceof Date ? date : new Date(date);
  return new Date(source.getFullYear(), source.getMonth(), source.getDate(), 12, 0, 0, 0);
}

function dateFromKey(key) {
  if (!DATE_KEY_PATTERN.test(String(key || ''))) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function shiftDate(date, deltaDays) {
  const shifted = localNoon(date);
  shifted.setDate(shifted.getDate() + deltaDays);
  return shifted;
}

export function normalizedDateList(dates) {
  return [...new Set((Array.isArray(dates) ? dates : [])
    .map(value => String(value || '').trim())
    .filter(value => DATE_KEY_PATTERN.test(value)))]
    .sort((a, b) => a.localeCompare(b));
}

export function normalizedActivity(activity) {
  return Object.fromEntries(Object.entries(activity && typeof activity === 'object' ? activity : {})
    .filter(([date, count]) => DATE_KEY_PATTERN.test(date) && Number(count) > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, count]) => [date, Math.max(0, Math.round(Number(count) || 0))]));
}

export function activityByDevice(settings) {
  const saved = settings?.exerciseActivityByDevice;
  const shards = saved && typeof saved === 'object' && Object.keys(saved).length
    ? Object.fromEntries(Object.entries(saved).map(([id, activity]) => [String(id), normalizedActivity(activity)]))
    : Object.keys(normalizedActivity(settings?.reviewActivity)).length ? { legacy: normalizedActivity(settings.reviewActivity) } : {};
  return shards;
}

export function mergeActivityByDevice(localSettings, remoteSettings) {
  const merged = activityByDevice(localSettings);
  for (const [deviceId, remoteActivity] of Object.entries(activityByDevice(remoteSettings))) {
    const localActivity = merged[deviceId] || {};
    const dates = [...new Set([...Object.keys(localActivity), ...Object.keys(remoteActivity)])];
    merged[deviceId] = normalizedActivity(Object.fromEntries(dates
      .map(date => [date, Math.max(Number(localActivity[date] || 0), Number(remoteActivity[date] || 0))])));
  }
  return merged;
}

export function aggregateActivity(shards) {
  const totals = {};
  for (const activity of Object.values(shards || {})) {
    for (const [date, count] of Object.entries(activity || {})) totals[date] = Number(totals[date] || 0) + Number(count || 0);
  }
  return normalizedActivity(totals);
}

export function streakFromActivity(activity, now = new Date(), freezeDates = [], dailyGoal = 1) {
  const threshold = Math.max(1, Math.round(Number(dailyGoal) || 1));
  const today = localDateKey(now);
  const yesterdayDate = shiftDate(now, -1);
  const yesterday = localDateKey(yesterdayDate);
  const freezeSet = new Set(normalizedDateList(freezeDates));
  let cursor = localNoon(now);
  if (!(Number(activity?.[today]) >= threshold)) {
    if (!(Number(activity?.[yesterday]) >= threshold) && !freezeSet.has(yesterday)) return 0;
    cursor = yesterdayDate;
  }
  let streak = 0;
  while (true) {
    const key = localDateKey(cursor);
    if (Number(activity?.[key]) >= threshold) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (freezeSet.has(key)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }
  return streak;
}

export function longestStreakFromActivity(activity = {}, freezeDates = [], storedBest = 0, dailyGoal = 1) {
  const threshold = Math.max(1, Math.round(Number(dailyGoal) || 1));
  const activeDates = Object.entries(activity && typeof activity === 'object' ? activity : {})
    .filter(([date, count]) => DATE_KEY_PATTERN.test(date) && Number(count) >= threshold)
    .map(([date]) => date);
  const freezeSet = new Set(normalizedDateList(freezeDates));
  const timeline = [...new Set([...activeDates, ...freezeSet])].sort((a, b) => a.localeCompare(b));
  const activeSet = new Set(activeDates);
  let best = Math.max(0, Math.round(Number(storedBest) || 0));
  let current = 0;
  let previousDate = null;
  for (const key of timeline) {
    const parsed = dateFromKey(key);
    if (!parsed) continue;
    if (previousDate) {
      const expected = localDateKey(shiftDate(previousDate, 1));
      if (expected !== key) current = 0;
    }
    if (activeSet.has(key)) {
      current += 1;
      if (current > best) best = current;
    }
    previousDate = parsed;
  }
  return best;
}

export function bankedStreakFreezes(awards = [], usedDates = []) {
  const earned = normalizedDateList(awards).length;
  const used = normalizedDateList(usedDates).length;
  return Math.max(0, Math.min(MAX_STREAK_FREEZES, earned - used));
}

export function isFreezeAwardStreak(streak) {
  const value = Math.max(0, Math.floor(Number(streak) || 0));
  return value === 3 || (value >= 7 && value % 7 === 0);
}

export function shouldAwardStreakFreeze(streak, todayKey, awards = [], usedDates = []) {
  if (!isFreezeAwardStreak(streak) || !DATE_KEY_PATTERN.test(String(todayKey || ''))) return false;
  const normalizedAwards = normalizedDateList(awards);
  if (normalizedAwards.includes(todayKey)) return false;
  return bankedStreakFreezes(normalizedAwards, usedDates) < MAX_STREAK_FREEZES;
}

export function nextFreezeMilestone(streak, banked = 0) {
  if (banked >= MAX_STREAK_FREEZES) return null;
  const value = Math.max(0, Math.floor(Number(streak) || 0));
  if (value < 3) return 3;
  return (Math.floor(value / 7) + 1) * 7;
}

export function autoApplyStreakFreezes(profile = {}, now = new Date()) {
  const activity = profile?.reviewActivity || {};
  const dailyGoal = Math.max(1, Math.round(Number(profile?.dailyGoal) || 20));
  const awards = normalizedDateList(profile?.streakFreezeAwards);
  const used = normalizedDateList(profile?.streakFreezeDates);
  const usedSet = new Set(used);
  const today = localDateKey(now);
  const banked = bankedStreakFreezes(awards, used);
  if (banked <= 0 || Number(activity[today]) >= dailyGoal) {
    return { appliedDates: [], streakFreezeDates: used, changed: false };
  }
  const yesterdayKey = localDateKey(shiftDate(now, -1));
  if (Number(activity[yesterdayKey]) >= dailyGoal || usedSet.has(yesterdayKey)) {
    return { appliedDates: [], streakFreezeDates: used, changed: false };
  }
  const gapDates = [];
  for (let offset = 1; offset <= banked; offset += 1) {
    const candidateDate = shiftDate(now, -offset);
    const key = localDateKey(candidateDate);
    if (Number(activity[key]) >= dailyGoal || usedSet.has(key)) break;
    gapDates.push(key);
  }
  if (!gapDates.length) return { appliedDates: [], streakFreezeDates: used, changed: false };
  const anchorDate = shiftDate(now, -(gapDates.length + 1));
  const anchorKey = localDateKey(anchorDate);
  const anchorHasSupport = Number(activity[anchorKey]) >= dailyGoal || usedSet.has(anchorKey);
  if (!anchorHasSupport || streakFromActivity(activity, anchorDate, used, dailyGoal) <= 0) {
    return { appliedDates: [], streakFreezeDates: used, changed: false };
  }
  const appliedDates = [...gapDates].reverse();
  const nextUsed = normalizedDateList([...used, ...appliedDates]);
  return { appliedDates, streakFreezeDates: nextUsed, changed: nextUsed.length !== used.length };
}

export function isStreakMilestone(streak) {
  const value = Math.max(0, Math.floor(Number(streak) || 0));
  return STREAK_MILESTONES.includes(value) || (value > 365 && value % 100 === 0);
}

export function nextStreakMilestone(streak) {
  const value = Math.max(0, Math.floor(Number(streak) || 0));
  const target = STREAK_MILESTONES.find(item => item > value) || (Math.floor(value / 100) + 1) * 100;
  const previous = [...STREAK_MILESTONES].reverse().find(item => item <= value) || 0;
  const span = Math.max(1, target - previous);
  const progressPercent = Math.min(100, Math.max(0, Math.round((value - previous) / span * 100)));
  return {
    target,
    previous,
    remaining: Math.max(1, target - value),
    progressPercent
  };
}

export function buildStreakWindow(activity = {}, freezeDates = [], { days = 7, dailyGoal = 20, now = new Date(), streak = null } = {}) {
  const count = Math.max(1, Math.min(90, Math.floor(Number(days) || 7)));
  const goal = Math.max(1, Math.round(Number(dailyGoal) || 20));
  const freezeSet = new Set(normalizedDateList(freezeDates));
  const activeStreak = streak == null ? streakFromActivity(activity, now, freezeDates, goal) : Math.max(0, Number(streak) || 0);
  const todayKey = localDateKey(now);
  return Array.from({ length: count }, (_, index) => {
    const date = shiftDate(now, -(count - 1 - index));
    const key = localDateKey(date);
    const exercises = Math.max(0, Math.round(Number(activity?.[key]) || 0));
    const isToday = key === todayKey;
    const isGoalReached = exercises >= goal;
    const isFrozen = !isGoalReached && freezeSet.has(key);
    const status = isGoalReached ? 'goal'
      : isFrozen ? 'frozen'
        : isToday && activeStreak > 0 ? 'at-risk'
          : exercises > 0 ? 'done'
            : isToday ? 'today'
              : 'missed';
    const intensity = exercises === 0 ? 0
      : isGoalReached ? 4
        : exercises >= Math.ceil(goal * 0.6) ? 3
          : exercises >= Math.ceil(goal * 0.25) ? 2
            : 1;
    const weekdayShort = date.toLocaleDateString(undefined, { weekday: 'short' });
    return {
      dateKey: key,
      weekdayShort: weekdayShort.slice(0, 2),
      weekdayNarrow: weekdayShort.slice(0, 1),
      dayNumber: date.getDate(),
      count: exercises,
      isToday,
      isFrozen,
      isGoalReached,
      status,
      intensity
    };
  });
}

export function getStreakSummary(profile = {}, now = new Date()) {
  const activity = profile?.reviewActivity || {};
  const freezeDates = normalizedDateList(profile?.streakFreezeDates);
  const freezeAwards = normalizedDateList(profile?.streakFreezeAwards);
  const freezeSet = new Set(freezeDates);
  const stats = currentStudyStats(profile, now);
  const currentStreak = stats.dailyStreak;
  const longestStreak = Math.max(currentStreak, stats.longestStreak || 0);
  const dailyGoal = Math.max(1, Math.round(Number(profile?.dailyGoal) || 20));
  const reviewsToday = stats.reviewsToday;
  const practicedToday = reviewsToday > 0;
  const goalReachedToday = reviewsToday >= dailyGoal;
  const streakSafeToday = goalReachedToday && currentStreak > 0;
  const atRisk = currentStreak > 0 && !goalReachedToday;
  const bankedFreezes = bankedStreakFreezes(freezeAwards, freezeDates);
  const yesterdayKey = localDateKey(shiftDate(now, -1));
  const protectedYesterday = freezeSet.has(yesterdayKey) && !(Number(activity[yesterdayKey]) >= dailyGoal);
  const milestone = nextStreakMilestone(currentStreak);
  const nextFreezeAtStreak = nextFreezeMilestone(currentStreak, bankedFreezes);
  const bestForBadges = Math.max(currentStreak, longestStreak);
  const achievedMilestones = STREAK_MILESTONES.filter(item => bestForBadges >= item);
  const weekWindow = buildStreakWindow(activity, freezeDates, { days: 7, dailyGoal, now, streak: currentStreak });
  const monthWindow = buildStreakWindow(activity, freezeDates, { days: 28, dailyGoal, now, streak: currentStreak });
  const activeDaysLast28 = monthWindow.filter(day => day.count > 0).length;
  return {
    currentStreak,
    longestStreak,
    dailyGoal,
    reviewsToday,
    practicedToday,
    goalReachedToday,
    streakSafeToday,
    atRisk,
    bankedFreezes,
    maxFreezes: MAX_STREAK_FREEZES,
    freezeDates,
    protectedYesterday,
    nextMilestone: milestone.target,
    daysToMilestone: milestone.remaining,
    milestoneProgressPercent: milestone.progressPercent,
    nextFreezeAtStreak,
    achievedMilestones,
    activeDaysLast28,
    weekWindow,
    monthWindow
  };
}

export function currentStudyStats(profile = {}, now = new Date()) {
  const activity = profile.reviewActivity || {};
  const dailyGoal = Math.max(1, Math.round(Number(profile.dailyGoal) || 20));
  const freezeDates = normalizedDateList(profile.streakFreezeDates);
  const today = localDateKey(now);
  const yesterdayKey = localDateKey(shiftDate(now, -1));
  const legacyActive = [today, yesterdayKey].includes(profile.lastReviewDate);
  const dailyStreak = Object.keys(activity).length
    ? streakFromActivity(activity, now, freezeDates, dailyGoal)
    : legacyActive ? Math.max(0, Number(profile.dailyStreak) || 0) : 0;
  const longestStreak = Math.max(
    dailyStreak,
    longestStreakFromActivity(activity, freezeDates, profile.longestStreak, dailyGoal)
  );
  return {
    dailyStreak,
    longestStreak,
    reviewsToday: Object.keys(activity).length ? Number(activity[today] || 0) : profile.reviewsDate === today ? Number(profile.reviewsToday || 0) : 0,
    reviewsDate: today
  };
}
