import { localDateKey } from '../utils/dates.js';

export const DAILY_REMINDER_ID = 73001;
export const STREAK_REMINDER_ID = 73002;
export const TEST_REMINDER_ID = 73003;
export const REMINDER_CHANNEL_ID = 'keepvocab-practice';
export const REMINDER_HORIZON_DAYS = 7;
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
  // Weekends often have a different rhythm. Use that pattern once it has
  // enough evidence, otherwise keep the robust median across all study days.
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const matchingDays = [...uniqueDays.entries()].filter(([day]) => {
    const weekday = new Date(`${day}T12:00:00`).getDay();
    return (weekday === 0 || weekday === 6) === weekend;
  }).map(([, minutes]) => minutes);
  const minutes = (matchingDays.length >= 3 ? matchingDays : [...uniqueDays.values()]).sort((a, b) => a - b);
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
  courseName = 'Vocabulary',
  hasLesson = false,
  practiceRoute = hasLesson ? 'learn' : 'daily',
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

  if (completed > 0) {
    return {
      time,
      title: `${courseName}: a fresh practice is ready`,
      body: 'Make a little time for learning today. A short practice keeps your habit growing.',
      route: practiceRoute,
      reason: remaining === 0 ? 'goal-complete' : 'studied-today',
      summary: remaining === 0 ? 'goal complete' : 'streak safe today',
      repeat: false,
      nextAt: getTomorrowReminderAt(time, now)
    };
  }

  if (due > 0) {
    return {
      time,
      title: `${courseName}: time for a little practice`,
      body: 'Revisit what you have learned and make it stick. Open your practice to see what is ready today.',
      route: practiceRoute,
      reason: 'due-review',
      summary: `${due} due`,
      repeat: false,
      nextAt: getNextReminderAt(time, now)
    };
  }

  return {
    time,
    title: hasLesson ? `${courseName}: your next lesson is ready` : `${courseName}: keep your learning growing`,
    body: hasLesson ? 'Pick up where you left off. One short lesson brings you closer to your next real conversation.' : 'A little practice goes a long way. Open KeepVocab and take the next step today.',
    route: practiceRoute,
    reason: 'keep-learning',
    summary: `${remaining} goal step${remaining === 1 ? '' : 's'} left`,
    repeat: false,
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
  if (!enabled || !activeStreak || !time) return null;
  const [hour, minute] = time.split(':').map(Number);
  const nextAt = new Date(now);
  nextAt.setHours(hour, minute, 0, 0);
  // Today's study protects today; prepare tomorrow's warning while the app is open.
  // Tomorrow's activity cancels and replaces this one-shot alarm.
  if (completed > 0) nextAt.setDate(nextAt.getDate() + 1);
  if (nextAt.getTime() <= now.getTime()) return null;
  return {
    time,
    title: `Protect your ${activeStreak}-day streak`,
    body: `One exercise before midnight keeps your streak alive. ${activeStreak % 7 === 6 ? 'Your next weekly milestone is within reach.' : 'A small step counts—even on a busy day.'}`,
    route: 'daily',
    reason: 'streak-maintenance',
    summary: `${activeStreak}-day streak safeguard`,
    repeat: false,
    nextAt
  };
}

// Only the next unprotected day can truthfully threaten the current streak.
// Later reminders stay encouraging and make no claims about stale streak counts.
export function buildReminderSchedule(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const plan = buildSmartReminderPlan({ ...options, now });
  if (localDateKey(plan.nextAt) !== localDateKey(now) && options.smartTiming !== false) {
    plan.time = getHabitReminderTime(options.reviewMoments, options.preferredTime, plan.nextAt);
    const [hour, minute] = plan.time.split(':').map(Number);
    plan.nextAt.setHours(hour, minute, 0, 0);
  }
  const followUps = [];
  for (let day = 1; day < REMINDER_HORIZON_DAYS; day += 1) {
    const date = new Date(plan.nextAt);
    date.setDate(date.getDate() + day);
    const time = options.smartTiming === false
      ? normalizeReminderTime(options.preferredTime || '19:00')
      : getHabitReminderTime(options.reviewMoments, options.preferredTime, date);
    const [hour, minute] = time.split(':').map(Number);
    date.setHours(hour, minute, 0, 0);
    followUps.push({
      time, nextAt: date, repeat: false,
      title: day > 2 ? 'A fresh start is one word away' : 'Your next small win is waiting',
      body: day > 2 ? 'No catching up required. Come back for a little practice whenever you are ready.' : 'Meet familiar words in a new way. A short workout helps them stick.',
      route: options.practiceRoute || (options.hasLesson ? 'learn' : 'daily'), reason: 'habit-follow-up'
    });
  }
  const streakPlan = buildStreakMaintenancePlan({
    enabled: options.streakReminderEnabled !== false,
    primaryTime: plan.time,
    reviewsToday: options.reviewsToday,
    streak: options.streak,
    now
  });
  if (streakPlan) streakPlan.route = options.practiceRoute || (options.hasLesson ? 'learn' : 'daily');
  return { ...plan, followUps, streakPlan };
}

export function reminderNotifications(plan, streakPlan = null) {
  const primary = [plan, ...(plan.followUps || [])].slice(0, REMINDER_HORIZON_DAYS).map((item, index) => {
    const [hour, minute] = normalizeReminderTime(item.time).split(':').map(Number);
    return {
      id: DAILY_REMINDER_ID + index * 10,
      channelId: REMINDER_CHANNEL_ID,
      title: item.title, body: item.body,
      schedule: item.repeat ? { on: { hour, minute }, allowWhileIdle: true }
        : { at: item.nextAt || getNextReminderAt(item.time), allowWhileIdle: true },
      autoCancel: true,
      extra: { route: item.route, reason: item.reason }
    };
  });
  if (streakPlan) primary.push({
    id: STREAK_REMINDER_ID, title: streakPlan.title, body: streakPlan.body,
    channelId: REMINDER_CHANNEL_ID,
    schedule: { at: streakPlan.nextAt || getNextReminderAt(streakPlan.time), allowWhileIdle: true },
    autoCancel: true, extra: { route: streakPlan.route, reason: streakPlan.reason }
  });
  return primary;
}

function reminderIds() {
  return [DAILY_REMINDER_ID, STREAK_REMINDER_ID,
    ...Array.from({ length: REMINDER_HORIZON_DAYS - 1 }, (_, index) => DAILY_REMINDER_ID + (index + 1) * 10)]
    .map(id => ({ id }));
}

export function supportsReminders(target = globalThis) {
  return target.Capacitor?.getPlatform?.() === 'android';
}

function getNativeNotifications(target = globalThis) {
  const capacitor = target.Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (platform !== 'android') return null;
  if (capacitor.Plugins?.LocalNotifications) return capacitor.Plugins.LocalNotifications;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('LocalNotifications');
  return null;
}

let notificationQueue = Promise.resolve();
function serializeNotifications(action) {
  const result = notificationQueue.then(action);
  notificationQueue = result.catch(() => {});
  return result;
}

async function scheduleNative(plugin, plan, streakPlan, requestPermission) {
  const readiness = await prepareNativeReminders(plugin, requestPermission);
  if (readiness.status !== 'ready') return readiness;
  const notifications = reminderNotifications(plan, streakPlan).map(item => ({
    ...item, isExactNotification: readiness.exactAlarm === 'granted'
  }));
  await plugin.cancel({ notifications: reminderIds() });
  await plugin.removeDeliveredNotifications?.({ notifications: reminderIds() });
  await plugin.schedule({ notifications });
  if (plugin.getPending) {
    const pending = await plugin.getPending();
    const ids = new Set(pending.notifications.map(item => item.id));
    if (notifications.some(item => !ids.has(item.id))) throw new Error('Android did not save every reminder. Try saving your routine again.');
  }
  return { status: 'scheduled', platform: 'native', exactAlarm: readiness.exactAlarm,
    nextAt: plan.nextAt || getNextReminderAt(plan.time), streakNextAt: streakPlan?.nextAt || null };
}

async function prepareNativeReminders(plugin, requestPermission = false) {
  let permission = await plugin.checkPermissions();
  if (permission.display !== 'granted' && requestPermission) permission = await plugin.requestPermissions();
  if (permission.display !== 'granted') return { status: 'permission-required', platform: 'native' };
  if (plugin.areEnabled && !(await plugin.areEnabled()).value) return { status: 'permission-required', platform: 'native' };
  await plugin.createChannel?.({ id: REMINDER_CHANNEL_ID, name: 'Practice reminders',
    description: 'Daily vocabulary practice and streak protection', importance: 4, visibility: 1, vibration: true });
  const channels = plugin.listChannels ? (await plugin.listChannels()).channels : [];
  if (channels.some(channel => channel.id === REMINDER_CHANNEL_ID && channel.importance === 0)) {
    return { status: 'channel-blocked', platform: 'native' };
  }
  const exact = plugin.checkExactNotificationSetting ? await plugin.checkExactNotificationSetting() : {};
  return { status: 'ready', platform: 'native', exactAlarm: exact.exact_alarm || 'denied' };
}

export async function getReminderStatus() {
  const plugin = getNativeNotifications();
  if (!plugin) return { status: supportsReminders() ? 'unavailable' : 'android-only' };
  return serializeNotifications(async () => {
    const ready = await prepareNativeReminders(plugin);
    if (ready.status !== 'ready') return ready;
    const pending = plugin.getPending ? (await plugin.getPending()).notifications : [];
    const ids = new Set(reminderIds().map(item => item.id));
    return { ...ready, pendingCount: pending.filter(item => ids.has(item.id)).length };
  });
}

export async function sendTestReminder() {
  const plugin = getNativeNotifications();
  if (!plugin) return { status: supportsReminders() ? 'unavailable' : 'android-only' };
  return serializeNotifications(async () => {
    const ready = await prepareNativeReminders(plugin, true);
    if (ready.status !== 'ready') return ready;
    await plugin.schedule({ notifications: [{ id: TEST_REMINDER_ID, channelId: REMINDER_CHANNEL_ID,
      title: 'KeepVocab notifications are working', body: 'Your practice reminders will appear here. Tap to open Practice.',
      isExactNotification: false, autoCancel: true, extra: { route: 'review', reason: 'delivery-test' } }] });
    return { status: 'test-sent', platform: 'native' };
  });
}

export async function openReminderSettings({ exactAlarms = false } = {}) {
  const plugin = getNativeNotifications();
  if (exactAlarms) return plugin?.changeExactNotificationSetting?.();
  const settings = globalThis.Capacitor?.Plugins?.ReminderSettings;
  if (!settings?.openNotificationSettings) throw new Error('Open Android Settings → Apps → KeepVocab → Notifications.');
  return settings.openNotificationSettings();
}

export async function scheduleDailyReminder({
  time = '19:00',
  title = 'A few words keep your streak growing',
  body = 'Your five-minute review is ready.',
  route = 'review',
  repeat = true,
  nextAt = null,
  reason = 'daily-reminder',
  streakPlan = null,
  followUps = [],
  requestPermission = false
} = {}) {
  const normalizedTime = normalizeReminderTime(time);
  const plan = { time: normalizedTime, title, body, route, repeat, reason, nextAt, followUps };
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) return serializeNotifications(() => scheduleNative(nativePlugin, plan, streakPlan, requestPermission));
  if (supportsReminders()) return { status: 'unavailable', platform: 'native', nextAt: null };
  return { status: 'android-only', platform: 'web', nextAt: null, streakNextAt: null };
}

export async function setupReminderNavigation(target = globalThis) {
  const plugin = getNativeNotifications(target);
  if (!plugin?.addListener) return false;
  await plugin.addListener('localNotificationActionPerformed', event => {
    const route = event?.notification?.extra?.route;
    if (!['dashboard', 'learn', 'daily', 'weak', 'review', 'library', 'stats', 'spelling', 'choose', 'visual', 'match', 'speaking'].includes(route)) return;
    if (target.location) target.location.hash = route;
    target.focus?.();
  });
  return true;
}

export async function cancelDailyReminder() {
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) await serializeNotifications(async () => {
    await nativePlugin.cancel({ notifications: reminderIds() });
    await nativePlugin.removeDeliveredNotifications?.({ notifications: reminderIds() });
  });
}
