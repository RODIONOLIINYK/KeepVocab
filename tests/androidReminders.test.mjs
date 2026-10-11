import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderSchedule, cancelDailyReminder, getReminderStatus, openReminderSettings, REMINDER_CHANNEL_ID,
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
    cancel: async value => {
      state.cancelled.push(value);
      const ids = new Set(value.notifications.map(item => item.id));
      state.pending = state.pending.filter(item => !ids.has(item.id));
    },
    schedule: async value => {
      state.scheduled.push(value);
      const ids = new Set(value.notifications.map(item => item.id));
      state.pending = options.dropPending ? [] : [
        ...state.pending.filter(item => !ids.has(item.id)),
        ...value.notifications.filter(item => item.schedule).map(({ id }) => ({ id }))
      ];
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

test('Android 7 can schedule notifications without unsupported notification channels', async () => {
  const state = native({ exact: 'granted' });
  globalThis.Capacitor.Plugins.LocalNotifications.createChannel = async () => {
    throw Object.assign(new Error('not available'), { code: 'UNAVAILABLE' });
  };
  try {
    assert.equal((await scheduleDailyReminder(buildReminderSchedule())).status, 'scheduled');
    assert.equal(state.scheduled[0].notifications.length, 7);
  } finally { delete globalThis.Capacitor; }
});

test('unexpected channel errors are surfaced without cancelling the routine', async () => {
  const state = native();
  globalThis.Capacitor.Plugins.LocalNotifications.createChannel = async () => { throw new Error('Channel failed'); };
  try {
    await assert.rejects(scheduleDailyReminder(buildReminderSchedule()), /Channel failed/);
    assert.equal(state.cancelled.length, 0);
  } finally { delete globalThis.Capacitor; }
});

test('background tests save an idle-safe alarm without cancelling daily reminders', async () => {
  const state = native({ exact: 'granted' });
  try {
    const before = Date.now();
    assert.equal((await sendTestReminder({ delaySeconds: 60 })).status, 'test-scheduled');
    const notification = state.scheduled[0].notifications[0];
    assert.ok(notification.schedule.at.getTime() >= before + 60_000);
    assert.equal(notification.schedule.allowWhileIdle, true);
    assert.equal(notification.isExactNotification, true);
    assert.equal(state.cancelled.length, 0);
  } finally { delete globalThis.Capacitor; }
});

test('testing and disabling a routine leave unrelated pending alarms alone', async () => {
  const state = native();
  try {
    await scheduleDailyReminder(buildReminderSchedule());
    await sendTestReminder({ delaySeconds: 60 });
    assert.equal((await getReminderStatus()).pendingCount, 7);
    assert.equal(state.pending.length, 8);
    assert.equal(state.cancelled.length, 1);
    await cancelDailyReminder();
    assert.deepEqual(state.pending, [{ id: TEST_REMINDER_ID }]);
  } finally { delete globalThis.Capacitor; }
});

test('background tests fall back without exact permission and reject dropped alarms', async () => {
  let state = native();
  try {
    const result = await sendTestReminder({ delaySeconds: 60 });
    assert.equal(result.exactAlarm, 'denied');
    assert.equal(state.scheduled[0].notifications[0].isExactNotification, false);
  } finally { delete globalThis.Capacitor; }
  state = native({ dropPending: true });
  try { await assert.rejects(sendTestReminder({ delaySeconds: 60 }), /did not save the background test/); }
  finally { delete globalThis.Capacitor; }
});

test('immediate tests verify actual Android notification visibility when available', async () => {
  native();
  const plugin = globalThis.Capacitor.Plugins.LocalNotifications;
  plugin.getDeliveredNotifications = async () => ({ notifications: [] });
  try {
    await assert.rejects(sendTestReminder(), /did not display/);
    plugin.getDeliveredNotifications = async () => ({ notifications: [{ id: TEST_REMINDER_ID }] });
    assert.equal((await sendTestReminder()).status, 'test-sent');
  } finally { delete globalThis.Capacitor; }
});

test('Android fallback warnings override a stale exact-alarm status', async () => {
  native({ exact: 'granted' });
  const plugin = globalThis.Capacitor.Plugins.LocalNotifications;
  const schedule = plugin.schedule;
  plugin.schedule = async value => ({ ...(await schedule(value)), warning: { code: 'OS-PLUG-LNOT-0017' } });
  try {
    assert.equal((await scheduleDailyReminder(buildReminderSchedule())).exactAlarm, 'denied');
    assert.equal((await sendTestReminder({ delaySeconds: 60 })).exactAlarm, 'denied');
  } finally { delete globalThis.Capacitor; }
});
