import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderSchedule, reminderNotifications, getHabitReminderTime, getPracticeReadiness, scheduleDailyReminder, cancelDailyReminder } from '../js/services/reminderService.js';

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

test('practice mode readiness schedules a reminder when SRS or 24h top-up exercises become ready', () => {
  const studyTime = new Date(2026, 8, 30, 12, 0);
  const srsReadyAt = new Date(2026, 8, 30, 15, 0).toISOString();
  const practiceWords = [
    {
      id: 'w-1',
      word: 'resilient',
      definition: 'Able to recover quickly.',
      nextReviewDate: srsReadyAt,
      practiceStats: { lastAnswerCorrect: false, attempts: 2 },
      mistakes: { consecutiveFailures: 1 }
    },
    {
      id: 'w-2',
      word: 'eloquent',
      definition: 'Fluent or persuasive in speaking.',
      nextReviewDate: new Date(2026, 9, 3, 12, 0).toISOString(),
      practiceStats: {
        lastAnsweredAt: new Date(2026, 8, 29, 15, 20).toISOString(),
        lastAnswerCorrect: true,
        successfulRecallDays: ['2026-09-29'],
        attempts: 1
      }
    }
  ];
  const plan = buildReminderSchedule({
    now: studyTime,
    reviewsToday: 2,
    dailyGoal: 20,
    streak: 5,
    preferredTime: '19:00',
    smartTiming: false,
    practiceWords
  });
  assert.ok(plan.practiceReadyPlan);
  assert.equal(plan.practiceReadyPlan.reason, 'practice-ready');
  assert.equal(plan.practiceReadyPlan.readyCount, 2);
  assert.equal(plan.practiceReadyPlan.time, '15:00');
  assert.match(plan.practiceReadyPlan.title, /2 review exercises ready in Practice Mode/);
  assert.match(plan.practiceReadyPlan.body, /18 more exercises completes today’s goal/);

  const alarms = reminderNotifications(plan, plan.streakPlan);
  assert.equal(alarms[0].extra.reason, 'practice-ready');
  assert.equal(alarms[0].schedule.at.getDate(), studyTime.getDate());
  assert.equal(alarms[0].schedule.at.getHours(), 15);
});

test('readiness waits for recent reliable recall even when an imported review date is overdue', () => {
  const recalledAt = new Date(now.getTime() - 60 * 60 * 1000);
  const word = {
    id: 'reliable', word: 'resilient', definition: 'Able to recover quickly.',
    nextReviewDate: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    practiceStats: {
      version: 2, attempts: 4, recalled: 4, successfulRecallDays: 4,
      lastAnswerCorrect: true, lastAnsweredAt: recalledAt.toISOString(),
      lastUnaidedRecallAt: recalledAt.toISOString()
    }
  };
  const readiness = getPracticeReadiness([word], now);
  assert.equal(readiness.readyNowCount, 0);
  assert.equal(readiness.nextReadyAt.getTime(), recalledAt.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(getPracticeReadiness([word], readiness.nextReadyAt).readyNowCount, 1);
});

test('readiness preserves successful legacy review history instead of scheduling an unnecessary top-up', () => {
  const nextReviewDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const word = {
    id: 'legacy', word: 'eloquent', definition: 'Fluent or persuasive in speaking.',
    nextReviewDate: nextReviewDate.toISOString(),
    practiceStats: {
      version: 1, attempts: 4, recalled: 4, lastAnswerCorrect: true,
      lastAnsweredAt: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString()
    }
  };
  const readiness = getPracticeReadiness([word], now);
  assert.equal(readiness.readyNowCount, 0);
  assert.equal(readiness.nextReadyAt.getTime(), nextReviewDate.getTime());
  assert.equal(getPracticeReadiness([word], new Date(now.getTime() + 2 * 60 * 60 * 1000)).readyNowCount, 0);
});

test('late-evening refresh after 20:30 escalates to a final-call streak rescue before midnight', () => {
  const lateEvening = new Date(2026, 8, 30, 21, 8);
  const plan = buildReminderSchedule({
    now: lateEvening,
    reviewsToday: 0,
    streak: 14,
    preferredTime: '19:00',
    smartTiming: false
  });
  assert.ok(plan.streakPlan);
  assert.equal(plan.streakPlan.finalCall, true);
  assert.equal(plan.streakPlan.time, '22:00');
  assert.equal(plan.streakPlan.nextAt.getDate(), lateEvening.getDate());
  assert.match(plan.streakPlan.title, /Final call: protect your 14-day streak/);
  assert.match(plan.streakPlan.body, /Midnight is close/);

  const afterTen = new Date(2026, 8, 30, 22, 20);
  const latePlan = buildReminderSchedule({
    now: afterTen,
    reviewsToday: 0,
    streak: 29,
    preferredTime: '19:00',
    smartTiming: false
  });
  assert.ok(latePlan.streakPlan);
  assert.equal(latePlan.streakPlan.finalCall, true);
  assert.equal(latePlan.streakPlan.time, '22:45');
  assert.match(latePlan.streakPlan.body, /30-day milestone/);
});
