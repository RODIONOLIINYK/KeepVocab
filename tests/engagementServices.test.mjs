import test from 'node:test';
import assert from 'node:assert/strict';

import { getInteractionSoundProfile } from '../js/services/interactionSound.js';
import { appendStudyMoment, buildSmartReminderPlan, formatReminderTime, getHabitReminderTime, getNextReminderAt, normalizeReminderTime } from '../js/services/reminderService.js';

test('reminder times are normalized and invalid input falls back safely', () => {
  assert.equal(normalizeReminderTime('7:05'), '07:05');
  assert.equal(normalizeReminderTime('23:59'), '23:59');
  assert.equal(normalizeReminderTime('25:00'), '19:00');
});

test('next reminder rolls to tomorrow after the selected time', () => {
  const before = new Date(2026, 7, 14, 18, 30);
  const after = new Date(2026, 7, 14, 20, 30);
  assert.equal(getNextReminderAt('19:00', before).getDate(), 14);
  assert.equal(getNextReminderAt('19:00', after).getDate(), 15);
  assert.match(formatReminderTime('19:00', 'en-US'), /7:00 PM/);
});

test('smart reminder timing learns the median of recent study days', () => {
  const now = new Date(2026, 7, 14, 12, 0);
  const moments = [
    new Date(2026, 7, 10, 20, 5).toISOString(),
    new Date(2026, 7, 11, 20, 20).toISOString(),
    new Date(2026, 7, 12, 19, 55).toISOString()
  ];
  assert.equal(getHabitReminderTime(moments, '19:00', now), '20:00');
  assert.equal(getHabitReminderTime(moments.slice(0, 2), '19:00', now), '19:00');
});

test('study moments keep one learning start per local day', () => {
  const morning = new Date(2026, 7, 14, 9, 0);
  const evening = new Date(2026, 7, 14, 19, 0);
  const first = appendStudyMoment([], morning);
  assert.deepEqual(appendStudyMoment(first, evening), first);
});

test('smart reminder plan uses due work, goal progress, and streak context', () => {
  const plan = buildSmartReminderPlan({
    preferredTime: '19:00',
    smartTiming: false,
    dueCount: 3,
    reviewsToday: 2,
    dailyGoal: 5,
    streak: 4,
    now: new Date(2026, 7, 14, 12, 0)
  });
  assert.equal(plan.time, '19:00');
  assert.equal(plan.route, 'review');
  assert.equal(plan.summary, '3 due');
  assert.match(plan.title, /3 words/);
  assert.match(plan.body, /4-day streak/);
});

test('smart reminder stops asking for work after the daily goal is complete', () => {
  const now = new Date(2026, 7, 14, 9, 0);
  const plan = buildSmartReminderPlan({ reviewsToday: 5, dailyGoal: 5, dueCount: 8, preferredTime: '19:00', now });
  assert.equal(plan.reason, 'goal-complete');
  assert.equal(plan.route, 'dashboard');
  assert.equal(plan.repeat, false);
  assert.match(plan.title, /fresh goal/i);
  assert.equal(plan.nextAt.getDate(), 15);
  assert.equal(plan.nextAt.getHours(), 19);
});

test('interaction sounds stay short and use distinct feedback contours', () => {
  const success = getInteractionSoundProfile('success');
  const error = getInteractionSoundProfile('error');
  const correct = getInteractionSoundProfile('correct');
  const wrong = getInteractionSoundProfile('wrong');
  assert.ok(success.length >= 2);
  assert.ok(success.at(-1).frequency > success[0].frequency);
  assert.ok(error.at(-1).frequency < error[0].frequency);
  assert.ok(correct.at(-1).frequency > correct[0].frequency);
  assert.ok(wrong.at(-1).frequency < wrong[0].frequency);
  assert.notDeepEqual(correct, success);
  assert.notDeepEqual(wrong, error);
  assert.ok([...success, ...error, ...correct, ...wrong].every(tone => tone.duration <= 0.15));
});
