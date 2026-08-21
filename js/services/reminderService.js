export const DAILY_REMINDER_ID = 73001;
export const STREAK_REMINDER_ID = 73002;
const MIN_SMART_HOUR = 8;
const MAX_SMART_MINUTES = 21 * 60 + 30;
const MIN_STREAK_MINUTES = 20 * 60 + 30;
const MAX_STREAK_MINUTES = 22 * 60;

export function normalizeReminderTime(value, fallback = '19:00') {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function getNextReminderAt(time, now = new Date()) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function getTomorrowReminderAt(time, now = new Date()) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function formatReminderTime(time, locale) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const value = new Date(2000, 0, 1, hour, minute);
  return value.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function appendStudyMoment(reviewMoments = [], now = new Date()) {
  const valid = (Array.isArray(reviewMoments) ? reviewMoments : [])
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()));
  const today = localDateKey(now);
  if (!valid.some(value => localDateKey(value) === today)) valid.push(new Date(now));
  return valid.sort((a, b) => b - a).slice(0, 45).map(value => value.toISOString());
}

export function getHabitReminderTime(reviewMoments = [], preferredTime = '19:00', now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 60);
  const uniqueDays = new Map();
  for (const value of Array.isArray(reviewMoments) ? reviewMoments : []) {
    const moment = new Date(value);
    if (Number.isNaN(moment.getTime()) || moment < cutoff || moment > now) continue;
    const key = localDateKey(moment);
    if (!uniqueDays.has(key)) uniqueDays.set(key, moment.getHours() * 60 + moment.getMinutes());
  }
  const minutes = [...uniqueDays.values()].sort((a, b) => a - b);
  if (minutes.length < 3) return normalizeReminderTime(preferredTime);
  const middle = Math.floor(minutes.length / 2);
  const median = minutes.length % 2 ? minutes[middle] : Math.round((minutes[middle - 1] + minutes[middle]) / 2);
  const rounded = Math.round(median / 15) * 15;
  const safeMinutes = Math.min(MAX_SMART_MINUTES, Math.max(MIN_SMART_HOUR * 60, rounded));
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, '0')}:${String(safeMinutes % 60).padStart(2, '0')}`;
}

export function buildSmartReminderPlan({
  preferredTime = '19:00',
  smartTiming = true,
  reviewMoments = [],
  dueCount = 0,
  reviewsToday = 0,
  dailyGoal = 20,
  streak = 0,
  now = new Date()
} = {}) {
  const normalizedGoal = Math.max(1, Number(dailyGoal || 20));
  const completed = Math.max(0, Number(reviewsToday || 0));
  const due = Math.max(0, Number(dueCount || 0));
  const remaining = Math.max(0, normalizedGoal - completed);
  const time = smartTiming
    ? getHabitReminderTime(reviewMoments, preferredTime, now)
    : normalizeReminderTime(preferredTime);

  if (remaining === 0) {
    return {
      time,
      title: 'A fresh goal is ready',
      body: 'You finished your last goal. Start a short session when you are ready to keep the routine growing.',
      route: 'dashboard',
      reason: 'goal-complete',
      summary: 'goal complete',
      repeat: false,
      nextAt: getTomorrowReminderAt(time, now)
    };
  }

  if (due > 0) {
    const usefulSteps = Math.min(due, remaining);
    const streakCopy = Number(streak || 0) > 0 ? ` and keeps your ${Number(streak)}-day streak growing` : '';
    return {
      time,
      title: `${due} word${due === 1 ? '' : 's'} ready for review`,
      body: `A five-minute review moves you ${usefulSteps} step${usefulSteps === 1 ? '' : 's'} toward today’s goal${streakCopy}.`,
      route: 'review',
      reason: 'due-review',
      summary: `${due} due`,
      repeat: true,
      nextAt: getNextReminderAt(time, now)
    };
  }

  return {
    time,
    title: 'Grow one more word with Sprig',
    body: `${remaining} step${remaining === 1 ? '' : 's'} remain today. Add a word or try a quick learning mode.`,
    route: 'dashboard',
    reason: 'keep-learning',
    summary: `${remaining} goal step${remaining === 1 ? '' : 's'} left`,
    repeat: true,
    nextAt: getNextReminderAt(time, now)
  };
}

export function getStreakReminderTime(primaryTime = '19:00') {
  const [hour, minute] = normalizeReminderTime(primaryTime).split(':').map(Number);
  const primaryMinutes = hour * 60 + minute;
  if (primaryMinutes >= MAX_STREAK_MINUTES) return '';
  const lateMinutes = Math.min(MAX_STREAK_MINUTES, Math.max(MIN_STREAK_MINUTES, primaryMinutes + 90));
  return `${String(Math.floor(lateMinutes / 60)).padStart(2, '0')}:${String(lateMinutes % 60).padStart(2, '0')}`;
}

export function buildStreakMaintenancePlan({
  enabled = true,
  primaryTime = '19:00',
  reviewsToday = 0,
  streak = 0,
  dueCount = 0,
  now = new Date()
} = {}) {
  const activeStreak = Math.max(0, Number(streak || 0));
  const completed = Math.max(0, Number(reviewsToday || 0));
  const time = getStreakReminderTime(primaryTime);
  if (!enabled || !activeStreak || completed > 0 || !time) return null;
  const due = Math.max(0, Number(dueCount || 0));
  const [hour, minute] = time.split(':').map(Number);
  const nextAt = new Date(now);
  nextAt.setHours(hour, minute, 0, 0);
  if (nextAt.getTime() <= now.getTime()) {
    if (now.getHours() < 23) nextAt.setTime(now.getTime() + 5 * 60_000);
    else {
      nextAt.setDate(nextAt.getDate() + 1);
      nextAt.setHours(hour, minute, 0, 0);
    }
  }
  return {
    time,
    title: `Protect your ${activeStreak}-day streak`,
    body: due
      ? `One quick review keeps your streak alive. ${due} word${due === 1 ? ' is' : 's are'} ready.`
      : 'Complete one quick exercise before the day ends to keep your streak alive.',
    route: due ? 'review' : 'daily',
    reason: 'streak-maintenance',
    summary: `${activeStreak}-day streak safeguard`,
    repeat: false,
    nextAt
  };
}

function getNativeNotifications(target = globalThis) {
  const capacitor = target.Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (platform !== 'android') return null;
  if (capacitor.Plugins?.LocalNotifications) return capacitor.Plugins.LocalNotifications;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('LocalNotifications');
  return null;
}

async function scheduleNative(plugin, plan, streakPlan, requestPermission) {
  let permission = await plugin.checkPermissions();
  if (permission.display !== 'granted' && requestPermission) permission = await plugin.requestPermissions();
  if (permission.display !== 'granted') return { status: 'permission-required', platform: 'native' };

  const [hour, minute] = plan.time.split(':').map(Number);
  const notifications = [{
    id: DAILY_REMINDER_ID,
    title: plan.title,
    body: plan.body,
    schedule: plan.repeat
      ? { on: { hour, minute }, allowWhileIdle: true }
      : { at: getTomorrowReminderAt(plan.time), allowWhileIdle: true },
    autoCancel: true,
    extra: { route: plan.route, reason: plan.reason }
  }];
  if (streakPlan) notifications.push({
    id: STREAK_REMINDER_ID,
    title: streakPlan.title,
    body: streakPlan.body,
    schedule: { at: streakPlan.nextAt || getNextReminderAt(streakPlan.time), allowWhileIdle: true },
    autoCancel: true,
    extra: { route: streakPlan.route, reason: streakPlan.reason }
  });
  await plugin.cancel({ notifications: [{ id: DAILY_REMINDER_ID }, { id: STREAK_REMINDER_ID }] });
  await plugin.schedule({
    notifications
  });
  return { status: 'scheduled', platform: 'native', nextAt: getNextReminderAt(plan.time), streakNextAt: streakPlan?.nextAt || null };
}

export async function scheduleDailyReminder({
  time = '19:00',
  title = 'A few words keep your streak growing',
  body = 'Your five-minute review is ready.',
  route = 'review',
  repeat = true,
  reason = 'daily-reminder',
  streakPlan = null,
  requestPermission = false
} = {}) {
  const normalizedTime = normalizeReminderTime(time);
  const plan = { time: normalizedTime, title, body, route, repeat, reason };
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) return scheduleNative(nativePlugin, plan, streakPlan, requestPermission);
  return { status: 'android-only', platform: 'web', nextAt: null, streakNextAt: null };
}

export async function setupReminderNavigation(target = globalThis) {
  const plugin = getNativeNotifications(target);
  if (!plugin?.addListener) return false;
  await plugin.addListener('localNotificationActionPerformed', event => {
    const route = event?.notification?.extra?.route;
    if (!['dashboard', 'daily', 'weak', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'speaking'].includes(route)) return;
    if (target.location) target.location.hash = route;
    target.focus?.();
  });
  return true;
}

export async function cancelDailyReminder() {
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) await nativePlugin.cancel({ notifications: [{ id: DAILY_REMINDER_ID }, { id: STREAK_REMINDER_ID }] });
}
