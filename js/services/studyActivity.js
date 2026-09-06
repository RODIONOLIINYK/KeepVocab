import { localDateKey } from '../utils/dates.js';

export function normalizedActivity(activity) {
  return Object.fromEntries(Object.entries(activity && typeof activity === 'object' ? activity : {})
    .filter(([date, count]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(count) > 0)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, count]) => [date, Math.max(0, Math.round(Number(count) || 0))]));
}

export function activityByDevice(settings) {
  const saved = settings?.exerciseActivityByDevice;
  const shards = saved && typeof saved === 'object' && Object.keys(saved).length
    ? Object.fromEntries(Object.entries(saved).map(([id, activity]) => [String(id), normalizedActivity(activity)]))
    : Object.keys(normalizedActivity(settings?.reviewActivity)).length ? { legacy: normalizedActivity(settings.reviewActivity) } : {};
  // Earlier versions saved lesson answers but never counted them as study activity.
  // A stable shard repairs those dates once and merges by max across devices.
  const recovered = {};
  for (const attempt of Object.values(settings?.lessonAttempts || {})) {
    const seen = new Set();
    for (const response of attempt?.responses || []) {
      if (response.activityRecorded || response.skipped || response.response === '[guidebook viewed]' || seen.has(response.exerciseId)) continue;
      const date = new Date(response.answeredAt);
      if (Number.isNaN(date.getTime())) continue;
      seen.add(response.exerciseId);
      const key = localDateKey(date);
      recovered[key] = (recovered[key] || 0) + 1;
    }
  }
  if (Object.keys(recovered).length) {
    const previous = shards['lesson-history'] || {};
    shards['lesson-history'] = { ...previous };
    for (const [date, count] of Object.entries(recovered)) shards['lesson-history'][date] = Math.max(count, Number(previous[date] || 0));
  }
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

export function streakFromActivity(activity, now = new Date()) {
  const today = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  let cursor = new Date(now);
  if (!(Number(activity?.[today]) > 0)) {
    if (!(Number(activity?.[localDateKey(yesterday)]) > 0)) return 0;
    cursor = yesterday;
  }
  let streak = 0;
  while (Number(activity?.[localDateKey(cursor)]) > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function currentStudyStats(profile = {}, now = new Date()) {
  const activity = profile.reviewActivity || {};
  const today = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const legacyActive = [today, localDateKey(yesterday)].includes(profile.lastReviewDate);
  return {
    dailyStreak: Object.keys(activity).length ? streakFromActivity(activity, now) : legacyActive ? Math.max(0, Number(profile.dailyStreak) || 0) : 0,
    reviewsToday: Object.keys(activity).length ? Number(activity[today] || 0) : profile.reviewsDate === today ? Number(profile.reviewsToday || 0) : 0,
    reviewsDate: today
  };
}
