import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderSchedule, reminderNotifications, getHabitReminderTime, scheduleDailyReminder, cancelDailyReminder } from '../js/services/reminderService.js';

const now = new Date(2026, 8, 30, 12);

test('one exercise silences today while preparing tomorrow’s streak rescue', () => {
  const plan = buildReminderSchedule({ now, reviewsToday: 1, dailyGoal: 20, streak: 6 });
  assert.equal(plan.reason, 'studied-today');
  const alarms = reminderNotifications(plan, plan.streakPlan);
  assert.equal(alarms.length, 8);
  assert.ok(alarms.every(item => item.schedule.at.getDate() !== now.getDate()));
  assert.equal(plan.streakPlan.nextAt.getDate(), 1);
  assert.match(plan.streakPlan.body, /milestone/);
});

test('only a live streak gets a rescue and later copy never threatens an expired streak', () => {
  const plan = buildReminderSchedule({ now, streak: 12 });
  const alarms = reminderNotifications(plan, plan.streakPlan);
  assert.ok(alarms.every(item => item.schedule.at && !item.schedule.on));
  assert.equal(new Set(alarms.map(item => item.id)).size, alarms.length);
  assert.equal(alarms.filter(item => item.extra.reason === 'streak-maintenance').length, 1);
  assert.ok(plan.followUps.every(item => !/streak|12/.test(item.title + item.body)));
  assert.match(plan.followUps.at(-1).body, /No catching up/);
  assert.equal(buildReminderSchedule({ now, streak: 0 }).streakPlan, null);
  assert.equal(buildReminderSchedule({ now, streak: 12, streakReminderEnabled: false }).streakPlan, null);
  assert.equal(buildReminderSchedule({ now: new Date(2026, 8, 30, 23, 30), streak: 12 }).streakPlan, null);
});

test('weekday and weekend habits use separate medians with a safe sparse-history fallback', () => {
  const moments = [
    new Date(2026, 8, 21, 19), new Date(2026, 8, 22, 19), new Date(2026, 8, 23, 19),
    new Date(2026, 8, 19, 10), new Date(2026, 8, 20, 10), new Date(2026, 8, 26, 10)
  ].map(date => date.toISOString());
  assert.equal(getHabitReminderTime(moments, '18:00', now), '19:00');
  assert.equal(getHabitReminderTime(moments, '18:00', new Date(2026, 9, 3, 9)), '10:00');
  assert.equal(getHabitReminderTime(moments.slice(0, 1), '18:00', now), '18:00');
  const plan = buildReminderSchedule({ now: new Date(2026, 9, 2, 20), reviewsToday: 1, reviewMoments: moments });
  assert.equal(plan.time, '10:00');
  assert.equal(plan.nextAt.getDay(), 6);
});

test('native scheduling removes old alarms and delivered warnings when activity changes', async () => {
  const calls = [];
  globalThis.Capacitor = { getPlatform: () => 'android', Plugins: { LocalNotifications: {
    checkPermissions: async () => ({ display: 'granted' }),
    cancel: async value => calls.push(['cancel', value]),
    removeDeliveredNotifications: async value => calls.push(['remove', value]),
    schedule: async value => calls.push(['schedule', value])
  } } };
  try {
    await scheduleDailyReminder(buildReminderSchedule({ now, streak: 5 }));
    await scheduleDailyReminder(buildReminderSchedule({ now, reviewsToday: 1, streak: 6 }));
    const alarms = calls.at(-1)[1].notifications;
    assert.ok(alarms.every(item => item.schedule.at > new Date(2026, 9, 1)));
    assert.deepEqual(calls.map(([type]) => type), ['cancel', 'remove', 'schedule', 'cancel', 'remove', 'schedule']);
    await cancelDailyReminder();
    assert.equal(calls.at(-1)[0], 'remove');
  } finally { delete globalThis.Capacitor; }
});

test('macOS never calls a desktop notification bridge', async () => {
  globalThis.keepVocabDesktop = {
    scheduleReminders: () => assert.fail('Reminders must never run on macOS'),
    cancelReminders: () => assert.fail('Reminders must never run on macOS')
  };
  try {
    assert.equal((await scheduleDailyReminder(buildReminderSchedule({ now }))).status, 'android-only');
    await cancelDailyReminder();
  } finally { delete globalThis.keepVocabDesktop; }
});
