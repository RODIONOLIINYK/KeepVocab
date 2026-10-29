import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardWorkoutState, renderDashboardView } from '../js/components/DashboardView.js';
import { renderStreakCelebration, streakMessage, streakWeek } from '../js/components/StreakCelebration.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { localDateKey } from '../js/utils/dates.js';
import { buildScheduledPracticeSession } from '../js/services/dailySession.js';
import { evaluateDailyStudyPlan } from '../js/services/wordSelection.js';
import { applyExerciseResultToWord } from '../js/services/exerciseResult.js';

const emptySession = () => ({ exercises: [], wordCount: 0, estimatedMinutes: 0 });
const plan = overrides => ({
  practicedTodayCount: 0,
  waitingTodayCount: 0,
  completedTodayCount: 0,
  reviseTomorrowCount: 0,
  isPlanComplete: false,
  nextReadyAt: null,
  ...overrides
});

test('Today offers a start action for ready words and includes later reviews in its copy', () => {
  const workout = dashboardWorkoutState({ exercises: [{ wordId: 'ready' }], wordCount: 1, estimatedMinutes: 1 },
    plan({ waitingTodayCount: 2 }), true);

  assert.equal(workout.state, 'ready');
  assert.equal(workout.action, 'Start practice');
  assert.match(workout.description, /1 word ready now/);
  assert.match(workout.description, /2 words will be ready later/);
});

test('Today offers to continue after a practiced word still has a later FSRS step', () => {
  const workout = dashboardWorkoutState({ exercises: [{ wordId: 'ready' }], wordCount: 2, estimatedMinutes: 3 },
    plan({ practicedTodayCount: 1, completedTodayCount: 0 }), true);

  assert.equal(workout.state, 'ready');
  assert.equal(workout.action, 'Continue practice');
  assert.match(workout.description, /2 words ready now/);
});

test('Today shows the next ready time while same-day words are resting', () => {
  const nextReadyAt = new Date(2026, 9, 23, 12, 10).toISOString();
  const workout = dashboardWorkoutState(emptySession(), plan({ waitingTodayCount: 1, nextReadyAt }), true);

  assert.equal(workout.state, 'waiting');
  assert.equal(workout.action, 'Explore your library');
  assert.match(workout.description, /1 word/);
  assert.ok(workout.description.includes(new Date(nextReadyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
  assert.doesNotMatch(workout.description, /finished|complete|caught up/i);
});

test('waiting words take precedence over a stale completion flag and have a safe missing-time fallback', () => {
  const workout = dashboardWorkoutState(emptySession(),
    plan({ waitingTodayCount: 2, isPlanComplete: true, completedTodayCount: 3 }), true);

  assert.equal(workout.state, 'waiting');
  assert.match(workout.description, /2 words/);
  assert.match(workout.description, /next review/i);
  assert.doesNotMatch(workout.description, /finished|complete|caught up/i);
});

test('Today celebrates a completed plan and reports the next study-day forecast', () => {
  const workout = dashboardWorkoutState(emptySession(),
    plan({ isPlanComplete: true, completedTodayCount: 3, reviseTomorrowCount: 1 }), true);

  assert.equal(workout.state, 'complete');
  assert.equal(workout.action, 'Explore your library');
  assert.match(workout.description, /finished 3 words/);
  assert.match(workout.description, /1 word scheduled for the next study day/);
});

test('a completed plan without a forecast explains the next 8 AM refresh', () => {
  const workout = dashboardWorkoutState(emptySession(), plan({ isPlanComplete: true, completedTodayCount: 1 }), true);

  assert.equal(workout.state, 'complete');
  assert.match(workout.description, /finished 1 word in today’s plan/);
  assert.match(workout.description, /next plan starts at 8:00 AM/);
});

test('a saved library without a current plan is resting, without claiming completion', () => {
  const workout = dashboardWorkoutState(emptySession(), plan(), true);

  assert.equal(workout.state, 'resting');
  assert.equal(workout.action, 'Explore your library');
  assert.match(workout.description, /fresh plan arrives at 8:00 AM/);
  assert.doesNotMatch(workout.description, /finished|completed/i);
});

test('an empty library asks for the first word instead of offering a workout', () => {
  const workout = dashboardWorkoutState(emptySession(), plan(), false);

  assert.equal(workout.state, 'empty');
  assert.equal(workout.action, 'Add your first word');
  assert.match(workout.description, /Save a word/);
});

test('a successful first FSRS answer moves Today from ready to waiting, then back to ready at its due time', () => {
  const now = new Date(2026, 9, 23, 12);
  const initial = { id: 'sprout', word: 'sprout', definition: 'To begin growing.', box: 1,
    createdAt: new Date(+now - 86400000).toISOString(), nextReviewDate: now.toISOString() };
  const initialPlan = evaluateDailyStudyPlan([initial], {}, { now });
  const settings = { dailyStudyPlan: initialPlan.snapshot };
  const before = buildScheduledPracticeSession([initial], settings, { now });
  assert.equal(dashboardWorkoutState(before, before.dailyPlan, true).state, 'ready');

  const answered = applyExerciseResultToWord(initial, {
    wordId: initial.id, exerciseType: 'daily-typed-recall', recallType: 'free-recall',
    correct: true, producedUnaided: true, hintsUsed: 0, responseTimeMs: 3000,
    occurredAt: now.toISOString()
  }).word;
  const due = new Date(answered.nextReviewDate);
  assert.ok(due > now);
  assert.ok(due < new Date(2026, 9, 24, 8));

  for (const at of [now, new Date(+due - 1)]) {
    const waiting = buildScheduledPracticeSession([answered], settings, { now: at });
    assert.equal(waiting.dailyPlan.completedTodayCount, 0);
    assert.equal(waiting.dailyPlan.isPlanComplete, false);
    assert.equal(dashboardWorkoutState(waiting, waiting.dailyPlan, true).state, 'waiting');
  }

  const retry = buildScheduledPracticeSession([answered], settings, { now: due });
  const workout = dashboardWorkoutState(retry, retry.dailyPlan, true);
  assert.equal(workout.state, 'ready');
  assert.equal(workout.action, 'Continue practice');
});

test('Today practice launchpad excludes the AI Speaking button while keeping vocabulary modes', () => {
  const container = { innerHTML: '', querySelector: () => ({ addEventListener: () => {} }), querySelectorAll: () => [] };
  renderDashboardView(container, () => {});
  assert.match(container.innerHTML, /Practice your way/);
  assert.doesNotMatch(container.innerHTML, /data-practice-view="speaking"|AI Speaking/);
  assert.match(container.innerHTML, /data-practice-view="useit"/);
  assert.match(container.innerHTML, /data-practice-view="weak"/);
});

test('first exercise of the day emits streak-extended once and renders Duolingo-style streak celebration', () => {
  const storage = new MemoryStorage();
  const service = new DriveSyncService(storage);
  const events = [];
  const originalDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = event => { if (event?.type === 'keepvocab:streak-extended') events.push(event.detail); return true; };
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    service.recordReview(yesterday);
    assert.equal(events.length, 0);

    const today = new Date();
    service.recordReview(today);
    assert.equal(events.length, 1);
    assert.equal(events[0].streak, 2);
    assert.equal(events[0].previousStreak, 1);
    assert.equal(events[0].date, localDateKey(today));

    service.recordReview(today);
    assert.equal(events.length, 1, 'second exercise on the same day does not re-trigger streak celebration');

    const markup = renderStreakCelebration({
      streak: events[0].streak,
      previousStreak: events[0].previousStreak,
      activity: service.getSettings().reviewActivity,
      now: today
    });
    assert.match(markup, /streak-flame-svg/);
    assert.match(markup, /streak-digit is-rolling/);
    assert.match(markup, /day streak!/);
    assert.equal(streakWeek(service.getSettings().reviewActivity, today).filter(day => day.done).length >= 1, true);
    assert.match(streakMessage(1), /started a new streak/i);
    assert.match(streakMessage(7), /1 week/i);
  } finally {
    if (originalDispatch === undefined) delete globalThis.dispatchEvent;
    else globalThis.dispatchEvent = originalDispatch;
  }
});
