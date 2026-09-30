import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SESSION_SIZE, buildDailySession, buildWeakWordsSession, hasImmediateDuplicates, recommendedExerciseType, selectPracticeWords } from '../js/services/dailySession.js';

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
  const session = buildDailySession(words, { now: NOW });
  assert.equal(session.exercises.length, DEFAULT_SESSION_SIZE);
  assert.ok(session.composition.due + session.composition.weak >= 8);
});

test('Daily Session includes weak vocabulary without letting it take over', () => {
  const words = Array.from({ length: 16 }, (_, index) => makeWord(index, index < 5 ? { mistakes: { incorrectAttempts: index + 1, consecutiveFailures: 1, recentFailures: [NOW.toISOString()] } } : {}));
  const session = buildDailySession(words, { now: NOW, targetSize: 12 });
  assert.ok(session.composition.weak >= 2);
  assert.ok(session.composition.weak < session.wordCount / 2);
  const weakOnly = buildWeakWordsSession(words, { now: NOW, targetSize: 8 });
  assert.ok(weakOnly.exercises.length > 0);
});

test('Daily Session avoids immediate unnecessary duplicate words', () => {
  const words = Array.from({ length: 3 }, (_, index) => makeWord(index));
  const session = buildDailySession(words, { now: NOW, targetSize: 6 });
  assert.equal(session.exercises.length, 6);
  assert.equal(hasImmediateDuplicates(session.exercises), false);
});

test('every workout word returns twice with a different task and no Use It mode', () => {
  for (const size of [1, 2, 3, 10, 30]) {
    const words = Array.from({ length: size }, (_, index) => makeWord(index, {
      example: `This is word${index}.`, imageUrl: 'https://example.com/image.png',
      mastery: { recognition: 1, recall: 1, context: 1, productive: 1 }
    }));
    const session = buildDailySession(words, { now: NOW });
    assert.equal(session.exercises.length, Math.min(size, 10) * 2);
    assert.equal(Object.values(session.composition).reduce((sum, count) => sum + count, 0), session.wordCount);
    assert.equal(hasImmediateDuplicates(session.exercises), false);
    for (const id of new Set(session.exercises.map(exercise => exercise.wordId))) {
      const visits = session.exercises.filter(exercise => exercise.wordId === id);
      assert.deepEqual(visits.map(exercise => exercise.round), [1, 2]);
      assert.notEqual(visits[0].exerciseType, visits[1].exerciseType);
      assert.ok(visits.every(exercise => !['use-it', 'weak'].includes(exercise.exerciseType)));
    }
    if (size >= 10) assert.ok(new Set(session.exercises.map(exercise => exercise.exerciseType)).size >= 5);
  }
});

test('cards without sentence gaps or meaningful choice alternatives use real recall', () => {
  const words = Array.from({ length: 10 }, (_, index) => makeWord(index, { definition: 'shared meaning', example: 'Unrelated sentence.' }));
  const session = buildDailySession(words, { now: NOW });
  assert.ok(session.exercises.every(exercise => !['context-cloze', 'meaning-recognition'].includes(exercise.exerciseType)));
  assert.ok(buildDailySession([makeWord(1)], { now: NOW }).exercises.every(exercise => !exercise.exerciseType.includes('recognition')));
});

test('another workout changes the recall skill used last time', () => {
  const words = Array.from({ length: 10 }, (_, index) => makeWord(index));
  const first = buildDailySession(words, { now: NOW });
  const practiced = words.map(word => ({ ...word, mastery: {
    lastExerciseType: `daily-${first.exercises.filter(exercise => exercise.wordId === word.id).at(-1).exerciseType}`
  } }));
  const next = buildDailySession(practiced, { now: NOW });
  for (const exercise of next.exercises.filter(exercise => exercise.round === 2)) {
    assert.notEqual(exercise.exerciseType, first.exercises.find(previous => previous.wordId === exercise.wordId && previous.round === 2).exerciseType);
  }
});

test('practice selection prioritizes problems and keeps one meaning per spelling', () => {
  const words = [
    makeWord(1, { word: 'bank', definition: 'A financial institution.', nextReviewDate: new Date(NOW.getTime() + 86400000).toISOString() }),
    makeWord(2, { word: 'bank', definition: 'Land beside a river.', mistakes: { incorrectAttempts: 4, consecutiveFailures: 2, recentFailures: [NOW.toISOString()] } }),
    makeWord(3, { word: 'steady', definition: 'Firmly fixed.', nextReviewDate: new Date(NOW.getTime() - 86400000).toISOString() }),
    makeWord(4, { word: 'easy', definition: 'Not difficult.', nextReviewDate: new Date(NOW.getTime() + 86400000).toISOString(), mastery: { recognition: 1, recall: 1, context: 1, productive: 1 } })
  ];
  const selected = selectPracticeWords(words, { now: NOW, limit: 10 });
  assert.deepEqual(selected.map(word => word.id), ['w-2', 'w-3', 'w-4']);
});

test('Daily Session handles empty and one-word libraries safely', () => {
  assert.deepEqual(buildDailySession([], { now: NOW }).exercises, []);
  const one = buildDailySession([makeWord(1)], { now: NOW, targetSize: 14 });
  assert.equal(one.exercises.length, 2);
  assert.equal(one.estimatedMinutes, 2);
});

test('mastery stages unlock progressively stronger exercise types', () => {
  assert.equal(recommendedExerciseType(makeWord(1)), 'definition-recognition');
  const recalled = makeWord(2, { mastery: { recognition: 1, recall: 0.8, context: 0, productive: 0, speaking: 0 } });
  assert.ok(['context-cloze', 'use-it'].includes(recommendedExerciseType(recalled)));
  const productive = makeWord(3, { mastery: { recognition: 1, recall: 1, context: 1, productive: 0.8, speaking: 0 } });
  assert.ok(['typed-recall', 'context-cloze', 'use-it'].includes(recommendedExerciseType(productive)));
});
