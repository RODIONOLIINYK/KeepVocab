export const DAILY_REMINDER_ID = 73001;

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

export function formatReminderTime(time, locale) {
  const [hour, minute] = normalizeReminderTime(time).split(':').map(Number);
  const value = new Date(2000, 0, 1, hour, minute);
  return value.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function getNativeNotifications(target = globalThis) {
  const capacitor = target.Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (!['android', 'ios'].includes(platform)) return null;
  if (capacitor.Plugins?.LocalNotifications) return capacitor.Plugins.LocalNotifications;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('LocalNotifications');
  return null;
}

async function scheduleNative(plugin, time, body, requestPermission) {
  let permission = await plugin.checkPermissions();
  if (permission.display !== 'granted' && requestPermission) permission = await plugin.requestPermissions();
  if (permission.display !== 'granted') return { status: 'permission-required', platform: 'native' };

  const [hour, minute] = time.split(':').map(Number);
  await plugin.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
  await plugin.schedule({
    notifications: [{
      id: DAILY_REMINDER_ID,
      title: 'A few words keep your streak growing',
      body,
      schedule: { on: { hour, minute }, allowWhileIdle: true },
      autoCancel: true,
      extra: { route: 'review' }
    }]
  });
  return { status: 'scheduled', platform: 'native', nextAt: getNextReminderAt(time) };
}

function clearWebTimer() {
  if (webReminderTimer) globalThis.clearTimeout(webReminderTimer);
  webReminderTimer = null;
}

function scheduleWebTimer(time, body) {
  clearWebTimer();
  const nextAt = getNextReminderAt(time);
  webReminderTimer = globalThis.setTimeout(() => {
    if (globalThis.Notification?.permission === 'granted') {
      const notification = new Notification('A few words keep your streak growing', {
        body,
        icon: './icons/keepvocab-mark-v2-192.png',
        tag: 'keepvocab-daily-reminder'
      });
      notification.onclick = () => {
        globalThis.focus?.();
        globalThis.location.hash = 'review';
        notification.close();
      };
    }
    scheduleWebTimer(time, body);
  }, Math.max(1000, nextAt.getTime() - Date.now()));
  return nextAt;
}

async function scheduleWeb(time, body, requestPermission) {
  if (!globalThis.Notification) return { status: 'in-app-only', platform: 'web', nextAt: getNextReminderAt(time) };
  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) permission = await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'permission-required', platform: 'web', nextAt: getNextReminderAt(time) };
  return { status: 'scheduled', platform: 'web', nextAt: scheduleWebTimer(time, body) };
}

export async function scheduleDailyReminder({ time = '19:00', body = 'Your five-minute review is ready.', requestPermission = false } = {}) {
  const normalizedTime = normalizeReminderTime(time);
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) return scheduleNative(nativePlugin, normalizedTime, body, requestPermission);
  return scheduleWeb(normalizedTime, body, requestPermission);
}

export async function cancelDailyReminder() {
  clearWebTimer();
  const nativePlugin = getNativeNotifications();
  if (nativePlugin) await nativePlugin.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
}
