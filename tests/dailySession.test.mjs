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

test('practice is seven typed descriptions and three visual matches with images available', () => {
  const words = Array.from({ length: 30 }, (_, index) => makeWord(index, {
    imageUrl: `https://example.com/word${index}.png`, example: `This is word${index}.`,
    mastery: { recognition: 1, recall: 1, context: 1, productive: 1 }
  }));
  const session = buildDailySession(words, { now: NOW });
  assert.equal(DEFAULT_SESSION_SIZE, 10);
  assert.equal(session.exercises.length, 10);
  assert.equal(session.exercises.filter(exercise => exercise.exerciseType === 'typed-recall').length, 7);
  assert.equal(session.exercises.filter(exercise => exercise.exerciseType === 'image-recognition').length, 3);
  assert.equal(new Set(session.exercises.map(exercise => exercise.wordId)).size, 10);
  assert.ok(session.exercises.every(exercise => !exercise.round));
});

test('the previous selection mix and selected word order are restored independently of task type', () => {
  const words = Array.from({ length: 24 }, (_, index) => makeWord(index, {
    ...(index < 8 ? { mistakes: { incorrectAttempts: index + 1, consecutiveFailures: 1, recentFailures: [NOW.toISOString()] } } : {}),
    nextReviewDate: index >= 8 && index < 16 ? new Date(NOW.getTime() - index * 60000).toISOString() : new Date(NOW.getTime() + 86400000).toISOString()
  }));
  const withoutImages = buildDailySession(words, { now: NOW });
  // Expected selection from the 1.7.4 scheduler for this fixture.
  assert.deepEqual(withoutImages.exercises.map(exercise => exercise.wordId), ['w-7', 'w-6', 'w-5', 'w-4', 'w-3', 'w-15', 'w-14', 'w-13', 'w-12', 'w-0']);
  assert.deepEqual(withoutImages.composition, { due: 4, weak: 5, growth: 1 });
  const withImages = buildDailySession(words.map(word => ({ ...word, imageUrl: 'https://example.com/image.png' })), { now: NOW });
  assert.deepEqual(withImages.exercises.map(exercise => exercise.wordId), withoutImages.exercises.map(exercise => exercise.wordId));
});

test('missing images fall back to typed descriptions without changing selected words', () => {
  const words = Array.from({ length: 12 }, (_, index) => makeWord(index));
  const session = buildDailySession(words, { now: NOW });
  assert.equal(session.exercises.length, 10);
  assert.ok(session.exercises.every(exercise => exercise.exerciseType === 'typed-recall'));
  const oneImage = buildDailySession(words.map((word, index) => index === 1 ? { ...word, imageUrl: 'https://example.com/one.png' } : word), { now: NOW });
  assert.equal(oneImage.exercises.filter(exercise => exercise.exerciseType === 'image-recognition').length, 1);
  assert.deepEqual(oneImage.exercises.map(exercise => exercise.wordId), session.exercises.map(exercise => exercise.wordId));
});

test('small libraries retain the previous session lengths and avoid consecutive repeats', () => {
  for (const [size, length] of [[0,0],[1,1],[2,4],[3,6],[4,10],[10,10],[30,10]]) {
    const session = buildDailySession(Array.from({length:size}, (_,index)=>makeWord(index,{imageUrl:'https://example.com/image.png'})), {now:NOW});
    assert.equal(session.exercises.length,length);
    assert.equal(hasImmediateDuplicates(session.exercises),false);
    if(size===1)assert.equal(session.exercises[0].exerciseType,'typed-recall');
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
