export const DAILY_REMINDER_ID = 73001;
const MIN_SMART_HOUR = 8;
const MAX_SMART_MINUTES = 21 * 60 + 30;

let webReminderTimer = null;

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

function getNativeNotifications(target = globalThis) {
  const capacitor = target.Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (!['android', 'ios'].includes(platform)) return null;
  if (capacitor.Plugins?.LocalNotifications) return capacitor.Plugins.LocalNotifications;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('LocalNotifications');
  return null;
}

async function scheduleNative(plugin, time, title, body, route, repeat, requestPermission) {
  let permission = await plugin.checkPermissions();
  if (permission.display !== 'granted' && requestPermission) permission = await plugin.requestPermissions();
  if (permission.display !== 'granted') return { status: 'permission-required', platform: 'native' };

  const [hour, minute] = time.split(':').map(Number);
  await plugin.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
  await plugin.schedule({
    notifications: [{
      id: DAILY_REMINDER_ID,
      title,
      body,
      schedule: repeat
        ? { on: { hour, minute }, allowWhileIdle: true }
        : { at: getTomorrowReminderAt(time), allowWhileIdle: true },
      autoCancel: true,
      extra: { route }
    }]
  });
  return { status: 'scheduled', platform: 'native', nextAt: getNextReminderAt(time) };
}

function clearWebTimer() {
  if (webReminderTimer) globalThis.clearTimeout(webReminderTimer);
  webReminderTimer = null;
}

function scheduleWebTimer(time, title, body, route, repeat) {
  clearWebTimer();
  const nextAt = repeat ? getNextReminderAt(time) : getTomorrowReminderAt(time);
  webReminderTimer = globalThis.setTimeout(() => {
    if (globalThis.Notification?.permission === 'granted') {
      const notification = new Notification(title, {
        body,
        icon: './icons/keepvocab-mark-v2-192.png',
        tag: 'keepvocab-daily-reminder'
      });
      notification.onclick = () => {
        globalThis.focus?.();
        globalThis.location.hash = route;
        notification.close();
      };
    }
    if (repeat) scheduleWebTimer(time, title, body, route, true);
  }, Math.max(1000, nextAt.getTime() - Date.now()));
  return nextAt;
}

async function scheduleWeb(time, title, body, route, repeat, requestPermission) {
  if (!globalThis.Notification) return { status: 'in-app-only', platform: 'web', nextAt: getNextReminderAt(time) };
  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) permission = await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'permission-required', platform: 'web', nextAt: getNextReminderAt(time) };
  return { status: 'scheduled', platform: 'web', nextAt: scheduleWebTimer(time, title, body, route, repeat) };
}

export async function scheduleDailyReminder({
  time = '19:00',
  title = 'A few words keep your streak growing',
  body = 'Your five-minute review is ready.',
  route = 'review',
  repeat = true,
  requestPermission = false
} = {}) {
  const normalizedTime = normalizeReminderTime(time);
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) return scheduleNative(nativePlugin, normalizedTime, title, body, route, repeat, requestPermission);
  return scheduleWeb(normalizedTime, title, body, route, repeat, requestPermission);
}

export async function setupReminderNavigation(target = globalThis) {
  const plugin = getNativeNotifications(target);
  if (!plugin?.addListener) return false;
  await plugin.addListener('localNotificationActionPerformed', event => {
    const route = event?.notification?.extra?.route;
    if (!['dashboard', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'speaking'].includes(route)) return;
    if (target.location) target.location.hash = route;
    target.focus?.();
  });
  return true;
}

export async function cancelDailyReminder() {
  clearWebTimer();
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) await nativePlugin.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
}
