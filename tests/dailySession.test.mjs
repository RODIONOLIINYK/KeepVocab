import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySession, buildWeakWordsSession, hasImmediateDuplicates, recommendedExerciseType } from '../js/services/dailySession.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

function makeWord(index, overrides = {}) {
  return {
    id: `w-${index}`,
    word: `word${index}`,
    definition: `definition ${index}`,
    createdAt: new Date(NOW.getTime() - index * 86400000).toISOString(),
    nextReviewDate: new Date(NOW.getTime() + 86400000).toISOString(),
    box: 1,
    ...overrides
  };
}

test('Daily Session prioritizes scheduled vocabulary', () => {
  const words = Array.from({ length: 20 }, (_, index) => makeWord(index, { nextReviewDate: index < 10 ? new Date(NOW.getTime() - index * 60000).toISOString() : new Date(NOW.getTime() + 86400000).toISOString() }));
  const session = buildDailySession(words, { now: NOW, targetSize: 14 });
  assert.equal(session.exercises.length, 14);
  assert.ok(session.composition.due >= 7);
  assert.ok(session.exercises.slice(0, 7).every(exercise => exercise.source === 'due'));
});

test('Daily Session includes weak vocabulary without letting it take over', () => {
  const words = Array.from({ length: 16 }, (_, index) => makeWord(index, index < 5 ? { mistakes: { incorrectAttempts: index + 1, consecutiveFailures: 1, recentFailures: [NOW.toISOString()] } } : {}));
  const session = buildDailySession(words, { now: NOW, targetSize: 12 });
  assert.ok(session.composition.weak >= 2);
  assert.ok(session.composition.weak < session.exercises.length / 2);
  const weakOnly = buildWeakWordsSession(words, { now: NOW, targetSize: 8 });
  assert.ok(weakOnly.exercises.length > 0);
});

test('Daily Session avoids immediate unnecessary duplicate words', () => {
  const words = Array.from({ length: 3 }, (_, index) => makeWord(index));
  const session = buildDailySession(words, { now: NOW, targetSize: 6 });
  assert.equal(session.exercises.length, 6);
  assert.equal(hasImmediateDuplicates(session.exercises), false);
});

test('Daily Session handles empty and one-word libraries safely', () => {
  assert.deepEqual(buildDailySession([], { now: NOW }).exercises, []);
  const one = buildDailySession([makeWord(1)], { now: NOW, targetSize: 14 });
  assert.equal(one.exercises.length, 1);
  assert.equal(one.estimatedMinutes, 1);
});

test('mastery stages unlock progressively stronger exercise types', () => {
  assert.equal(recommendedExerciseType(makeWord(1)), 'definition-recognition');
  const recalled = makeWord(2, { mastery: { recognition: 1, recall: 0.8, context: 0, productive: 0, speaking: 0 } });
  assert.ok(['context-cloze', 'use-it'].includes(recommendedExerciseType(recalled)));
  const productive = makeWord(3, { mastery: { recognition: 1, recall: 1, context: 1, productive: 0.8, speaking: 0 } });
  assert.ok(['typed-recall', 'context-cloze', 'use-it'].includes(recommendedExerciseType(productive)));
});
