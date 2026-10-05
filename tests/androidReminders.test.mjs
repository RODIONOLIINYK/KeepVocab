import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderSchedule, getReminderStatus, openReminderSettings, REMINDER_CHANNEL_ID,
  scheduleDailyReminder, sendTestReminder, TEST_REMINDER_ID } from '../js/services/reminderService.js';

function native(options = {}) {
  const state = { scheduled: [], cancelled: [], requests: 0, exactSettings: 0, pending: [] };
  const plugin = {
    checkPermissions: async () => ({ display: options.permission || 'granted' }),
    requestPermissions: async () => { state.requests++; return { display: options.requestedPermission || 'granted' }; },
    areEnabled: async () => ({ value: options.enabled !== false }),
    checkExactNotificationSetting: async () => ({ exact_alarm: options.exact || 'denied' }),
    changeExactNotificationSetting: async () => { state.exactSettings++; },
    createChannel: async channel => { state.channel = channel; },
    listChannels: async () => ({ channels: [{ id: REMINDER_CHANNEL_ID, importance: options.blockedChannel ? 0 : 4 }] }),
    cancel: async value => { state.cancelled.push(value); state.pending = []; },
    schedule: async value => {
      state.scheduled.push(value);
      state.pending = options.dropPending ? [] : value.notifications.filter(item => item.schedule).map(({ id }) => ({ id }));
      return { notifications: value.notifications.map(({ id }) => ({ id })) };
    },
    getPending: async () => ({ notifications: state.pending })
  };
  globalThis.Capacitor = { getPlatform: () => 'android', Plugins: { LocalNotifications: plugin,
    ReminderSettings: { openNotificationSettings: async () => { state.settingsOpened = true; } } } };
  return state;
}

test('denied exact-alarm access uses idle-safe inexact reminders without opening settings', async () => {
  const state = native();
  try {
    const result = await scheduleDailyReminder(buildReminderSchedule({ streak: 5, now: new Date(2026, 9, 5, 12) }));
    assert.equal(result.status, 'scheduled');
    assert.equal(result.exactAlarm, 'denied');
    assert.equal(state.exactSettings, 0);
    assert.equal(state.channel.id, REMINDER_CHANNEL_ID);
    assert.ok(state.scheduled[0].notifications.every(item => item.isExactNotification === false && item.schedule.allowWhileIdle));
    assert.equal((await getReminderStatus()).pendingCount, 8);
  } finally { delete globalThis.Capacitor; }
});

test('granted exact-alarm access schedules precise reminders', async () => {
  const state = native({ exact: 'granted' });
  try {
    await scheduleDailyReminder(buildReminderSchedule());
    assert.ok(state.scheduled[0].notifications.every(item => item.isExactNotification === true));
  } finally { delete globalThis.Capacitor; }
});

test('blocked app or channel permissions return actionable status without erasing alarms', async () => {
  for (const [options, status] of [
    [{ permission: 'denied' }, 'permission-required'],
    [{ enabled: false }, 'permission-required'],
    [{ blockedChannel: true }, 'channel-blocked']
  ]) {
    const state = native(options);
    try {
      assert.equal((await scheduleDailyReminder(buildReminderSchedule())).status, status);
      assert.equal(state.requests, 0);
      assert.equal(state.scheduled.length, 0);
      assert.equal(state.cancelled.length, 0);
    } finally { delete globalThis.Capacitor; }
  }
});

test('test notification requests permission and is immediate without cancelling the routine', async () => {
  const state = native({ permission: 'prompt' });
  try {
    assert.equal((await sendTestReminder()).status, 'test-sent');
    assert.equal(state.requests, 1);
    assert.equal(state.cancelled.length, 0);
    const notification = state.scheduled[0].notifications[0];
    assert.equal(notification.id, TEST_REMINDER_ID);
    assert.equal(notification.schedule, undefined);
    assert.equal(notification.extra.route, 'review');
    await openReminderSettings();
    assert.equal(state.settingsOpened, true);
    await openReminderSettings({ exactAlarms: true });
    assert.equal(state.exactSettings, 1);
  } finally { delete globalThis.Capacitor; }
});

test('missing native bridge and dropped alarms cannot report successful setup', async () => {
  globalThis.Capacitor = { getPlatform: () => 'android' };
  try {
    assert.equal((await scheduleDailyReminder()).status, 'unavailable');
    assert.equal((await getReminderStatus()).status, 'unavailable');
  } finally { delete globalThis.Capacitor; }
  native({ dropPending: true });
  try { await assert.rejects(scheduleDailyReminder(buildReminderSchedule()), /did not save every reminder/); }
  finally { delete globalThis.Capacitor; }
});
