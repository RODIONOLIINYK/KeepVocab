import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountPracticeCompletion, renderStreakCelebration, streakWeek } from '../js/components/StreakCelebration.js';
import { localDateKey } from '../js/utils/dates.js';

// Minimal DOM boundary keeps lifecycle assertions about visible insertion,
// focus, storage, and detached screens independent of a browser dependency.
function resultScreen({ connected = true } = {}) {
  const classes = new Set();
  const inserted = [];
  const actions = { insertAdjacentHTML: (_, html) => inserted.push(html) };
  const screen = {
    classList: { contains: name => classes.has(name), add: name => classes.add(name) },
    ownerDocument: { createElement: () => ({ setAttribute() {}, insertAdjacentHTML() {} }) },
    querySelector: selector => selector === 'img' ? null : actions,
    prepend() {}
  };
  return { isConnected: connected, querySelector: () => screen, classes, inserted };
}

function context(day) {
  const now = new Date(2026, 10, day, 12);
  const key = localDateKey(now);
  const saved = new Map();
  return { now, key, settings: { dailyStreak: 7, reviewActivity: { [key]: 3 } }, host: { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } }, saved };
}

test('empty or abandoned practice cannot earn a completion surface', () => {
  const options = context(8);
  const empty = resultScreen();
  assert.equal(mountPracticeCompletion(empty, { ...options, completedCount: 0 }), false);
  assert.equal(empty.classes.size, 0);
  const abandoned = resultScreen({ connected: false });
  assert.equal(mountPracticeCompletion(abandoned, { ...options, completedCount: 4 }), false);
  assert.equal(abandoned.inserted.length, 0);
  assert.equal(options.saved.size, 0);
});

test('completed sessions earn inline feedback and one streak per local day across sessions', () => {
  const options = context(9);
  const first = resultScreen();
  assert.equal(mountPracticeCompletion(first, { ...options, completedCount: 4 }), true);
  assert.equal(first.inserted.length, 1);
  assert.equal(options.saved.get('keepvocab_completion_streak_date'), options.key);
  assert.equal(mountPracticeCompletion(first, { ...options, completedCount: 4 }), false, 'rerendering the same result does not replay it');
  const next = resultScreen();
  assert.equal(mountPracticeCompletion(next, { ...options, completedCount: 2 }), true);
  assert.ok(next.classes.has('completion-feedback'));
  assert.equal(next.inserted.length, 0, 'another session still gets encouragement without repeating the daily streak');
  const tomorrow = context(10);
  const another = resultScreen();
  mountPracticeCompletion(another, { ...tomorrow, completedCount: 2 });
  assert.equal(another.inserted.length, 1);
});

test('persisted daily marker prevents replays after app restart', () => {
  const options = context(11);
  options.saved.set('keepvocab_completion_streak_date', options.key);
  const screen = resultScreen();
  mountPracticeCompletion(screen, { ...options, completedCount: 1 });
  assert.equal(screen.inserted.length, 0);
});

test('private storage failure never blocks completed practice', () => {
  const options = context(12);
  options.host.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const screen = resultScreen();
  assert.doesNotThrow(() => mountPracticeCompletion(screen, { ...options, completedCount: 1 }));
  assert.equal(screen.inserted.length, 1);
});

test('completion without actual review activity never claims a streak', () => {
  const options = context(13);
  options.settings.reviewActivity = {};
  const screen = resultScreen();
  mountPracticeCompletion(screen, { ...options, completedCount: 1 });
  assert.equal(screen.inserted.length, 0);
});

test('streak uses local week and accessible current-day evidence without an overlay', () => {
  const options = context(3);
  const html = renderStreakCelebration({ streak: 7, activity: options.settings.reviewActivity, now: options.now });
  assert.match(html, /aria-current="date"/);
  assert.match(html, /2026-11-03: practiced/);
  assert.doesNotMatch(html, /dialog|aria-modal|button|streak-celebration/);
  assert.equal(streakWeek({}, new Date(2027, 0, 1)).length, 7);
});

test('app startup never subscribes to a streak celebration or completion timer', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const component = await readFile(new URL('../js/components/StreakCelebration.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /setupStreakCelebration/);
  assert.doesNotMatch(component, /addEventListener|setTimeout|\.focus\(/);
});
