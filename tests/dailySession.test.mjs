import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SESSION_SIZE, buildDailySession, buildWeakWordsSession, hasImmediateDuplicates, practicePriorityScore, recommendedExerciseType, selectPracticeWords } from '../js/services/dailySession.js';
import { applyExerciseResultToWord } from '../js/services/exerciseResult.js';
import { applyModeSelectionToWord, normalizeWordPracticeStats } from '../js/services/wordSelection.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

function makeWord(index, overrides = {}) {
  return {
    id: `w-${index}`,
    word: `word${index}`,
    definition: `definition ${index}`,
    createdAt: new Date(NOW.getTime() - index * 86400000).toISOString(),
    nextReviewDate: NOW.toISOString(),
    box: 1,
    ...overrides
  };
}

test('Daily Session prioritizes scheduled vocabulary', () => {
  const words = Array.from({ length: 20 }, (_, index) => makeWord(index, { nextReviewDate: index < 10 ? new Date(NOW.getTime() - index * 60000).toISOString() : new Date(NOW.getTime() + 86400000).toISOString() }));
  const session = buildDailySession(words, { now: NOW });
  assert.equal(session.exercises.length, 10);
  assert.deepEqual(new Set(session.exercises.map(exercise => exercise.wordId)), new Set(words.slice(0, 10).map(word => word.id)));
});

test('Daily Session includes weak vocabulary without letting it take over', () => {
  const words = Array.from({ length: 16 }, (_, index) => makeWord(index, index < 5 ? { mistakes: { incorrectAttempts: index + 1, consecutiveFailures: 1, recentFailures: [NOW.toISOString()] } } : {}));
  const session = buildDailySession(words, { now: NOW, targetSize: 12 });
  assert.ok(session.composition.weak >= 2);
  assert.ok(session.composition.weak < session.exercises.length);
  const weakOnly = buildWeakWordsSession(words, { now: NOW, targetSize: 8 });
  assert.ok(weakOnly.exercises.length > 0);
});

test('Daily Session avoids immediate unnecessary duplicate words', () => {
  const words = Array.from({ length: 3 }, (_, index) => makeWord(index));
  const session = buildDailySession(words, { now: NOW, targetSize: 6 });
  assert.equal(session.exercises.length, 3);
  assert.equal(new Set(session.exercises.map(exercise => exercise.wordId)).size, 3);
  assert.equal(hasImmediateDuplicates(session.exercises), false);
});

test('practice is fourteen typed descriptions and six visual matches with images available', () => {
  const words = Array.from({ length: 30 }, (_, index) => makeWord(index, {
    imageUrl: `https://example.com/word${index}.png`, example: `This is word${index}.`,
    mastery: { recognition: 1, recall: 1, context: 1, productive: 1 }
  }));
  const session = buildDailySession(words, { now: NOW });
  assert.equal(DEFAULT_SESSION_SIZE, 20);
  assert.equal(session.exercises.length, 20);
  assert.equal(session.exercises.filter(exercise => exercise.exerciseType === 'typed-recall').length, 14);
  assert.equal(session.exercises.filter(exercise => exercise.exerciseType === 'image-recognition').length, 6);
  assert.equal(new Set(session.exercises.map(exercise => exercise.wordId)).size, 20);
  assert.ok(session.exercises.every(exercise => !exercise.round));
});

test('only due words are selected, and images never change selected words or order', () => {
  const words = Array.from({ length: 24 }, (_, index) => makeWord(index, {
    ...(index < 8 ? { mistakes: { incorrectAttempts: index + 1, consecutiveFailures: 1, recentFailures: [NOW.toISOString()] } } : {}),
    nextReviewDate: index >= 8 && index < 16 ? new Date(NOW.getTime() - index * 60000).toISOString() : new Date(NOW.getTime() + 86400000).toISOString()
  }));
  const withoutImages = buildDailySession(words, { now: NOW });
  assert.equal(withoutImages.exercises.length, 8);
  assert.deepEqual(new Set(withoutImages.exercises.map(exercise => exercise.wordId)), new Set(words.slice(8, 16).map(word => word.id)));
  const withImages = buildDailySession(words.map(word => ({ ...word, imageUrl: 'https://example.com/image.png' })), { now: NOW });
  assert.deepEqual(withImages.exercises.map(exercise => exercise.wordId), withoutImages.exercises.map(exercise => exercise.wordId));
});

test('missing images fall back to typed descriptions without changing selected words', () => {
  const words = Array.from({ length: 12 }, (_, index) => makeWord(index));
  const session = buildDailySession(words, { now: NOW });
  assert.equal(session.exercises.length, 12);
  assert.ok(session.exercises.every(exercise => exercise.exerciseType === 'typed-recall'));
  const imageWordId = session.exercises[0].wordId;
  const oneImage = buildDailySession(words.map(word => word.id === imageWordId ? { ...word, imageUrl: 'https://example.com/one.png' } : word), { now: NOW });
  assert.equal(oneImage.exercises.filter(exercise => exercise.exerciseType === 'image-recognition').length, 1);
  assert.deepEqual(oneImage.exercises.map(exercise => exercise.wordId), session.exercises.map(exercise => exercise.wordId));
});

test('small libraries get one task per distinct word without filler repetition', () => {
  for (const [size, length] of [[0,0],[1,1],[2,2],[3,3],[4,4],[10,10],[20,20],[30,20]]) {
    const session = buildDailySession(Array.from({length:size}, (_,index)=>makeWord(index,{imageUrl:'https://example.com/image.png'})), {now:NOW});
    assert.equal(session.exercises.length,length);
    assert.equal(hasImmediateDuplicates(session.exercises),false);
    assert.equal(new Set(session.exercises.map(exercise => exercise.wordId)).size,length);
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
  assert.deepEqual(new Set(selected.map(word => word.id)), new Set(['w-2', 'w-3', 'w-4']));
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

function answer(word, correct, now, exerciseType = 'typed-recall') {
  return applyExerciseResultToWord(word, {
    wordId: word.id, exerciseType: `daily-${exerciseType}`, correct,
    recallType: exerciseType === 'image-recognition' ? 'recognition' : 'free-recall',
    producedUnaided: correct && exerciseType === 'typed-recall',
    responseTimeMs: 2000, occurredAt: now.toISOString()
  }).word;
}

test('consecutive successful sessions cover the library instead of repeating the same twenty words', () => {
  let words = Array.from({ length: 27 }, (_, index) => makeWord(index, { imageUrl: 'image.png' }));
  const seen = new Set();
  for (const expectedLength of [20, 7]) {
    const session = buildDailySession(words, { now: NOW });
    assert.equal(session.exercises.length, expectedLength);
    for (const exercise of session.exercises) {
      assert.equal(seen.has(exercise.wordId), false);
      seen.add(exercise.wordId);
      words = words.map(word => word.id === exercise.wordId
        ? answer(applyModeSelectionToWord(word, { mode: 'practice', now: NOW }), true, NOW, exercise.exerciseType)
        : word);
    }
  }
  assert.equal(seen.size, 27);
  assert.deepEqual(buildDailySession(words, { now: NOW }).exercises, []);
  assert.equal(buildDailySession(words, { now: NOW }).estimatedMinutes, 0);
  for (const word of words) {
    const stats = normalizeWordPracticeStats(word);
    assert.equal(stats.attempts, 1);
    assert.equal(stats.byMode.practice.selections, 1);
    assert.equal(stats.byMode.practice.recalled, 1);
  }
});

test('misses return only at their scheduled time, and recovery immediately changes the next decision', () => {
  let word = answer(makeWord(1), false, NOW);
  const retryAt = new Date(word.nextReviewDate);
  assert.ok(retryAt > NOW);
  assert.deepEqual(buildDailySession([word], { now: NOW }).exercises, []);
  assert.deepEqual(buildDailySession([word], { now: new Date(retryAt.getTime() - 1) }).exercises, []);
  assert.equal(buildDailySession([word], { now: retryAt }).exercises.length, 1);
  assert.equal(buildDailySession([word], { now: retryAt }).composition.weak, 1);

  word = answer(word, true, retryAt);
  const recoveredAt = new Date(word.nextReviewDate);
  assert.deepEqual(buildDailySession([word], { now: retryAt }).exercises, []);
  assert.ok(recoveredAt.getTime() - retryAt.getTime() > retryAt.getTime() - NOW.getTime());
  const later = buildDailySession([word], { now: recoveredAt });
  assert.equal(later.exercises.length, 1);
  assert.equal(later.composition.weak, 0);
  word = answer(word, true, recoveredAt);
  assert.ok(new Date(word.nextReviewDate) - recoveredAt > recoveredAt - retryAt);
});

test('correct Visual Match and typed answers both respect the per-word review schedule', () => {
  for (const exerciseType of ['typed-recall', 'image-recognition']) {
    const word = answer(makeWord(1), true, NOW, exerciseType);
    assert.deepEqual(buildDailySession([word], { now: NOW }).exercises, []);
    assert.equal(buildDailySession([word], { now: new Date(word.nextReviewDate) }).exercises.length, 1);
  }
});

test('past lifetime mistakes do not outrank a fresh unresolved miss after recovery', () => {
  const recovered = answer(makeWord(1, {
    mistakes: { incorrectAttempts: 1000, recentFailures: [new Date(NOW.getTime() - 60000).toISOString()] },
    practiceStats: { attempts: 1001, recalled: 1, missed: 1000 }
  }), true, NOW);
  const failed = answer(makeWord(2), false, NOW);
  const later = new Date(Math.max(Date.parse(recovered.nextReviewDate), Date.parse(failed.nextReviewDate)));
  assert.ok(practicePriorityScore(failed, later) > practicePriorityScore(recovered, later));
  assert.deepEqual(buildDailySession([recovered, failed], { now: later, targetSize: 1 }).exercises.map(exercise => exercise.wordId), [failed.id]);
});

test('starting another session rotates unanswered due words without inventing answers', () => {
  let words = Array.from({ length: 30 }, (_, index) => makeWord(index));
  const first = buildDailySession(words, { now: NOW, targetSize: 10 });
  const ids = new Set(first.exercises.map(exercise => exercise.wordId));
  words = words.map(word => ids.has(word.id) ? applyModeSelectionToWord(word, { mode: 'practice', now: NOW }) : word);
  const second = buildDailySession(words, { now: NOW, targetSize: 10 });
  assert.equal(second.exercises.length, 10);
  assert.equal(second.exercises.some(exercise => ids.has(exercise.wordId)), false);
  assert.equal(words.every(word => normalizeWordPracticeStats(word).attempts === 0), true);
});

test('dashboard previews are read-only and respect legacy future reviews and duplicate spellings', () => {
  const words = [
    makeWord(1, { word: 'bank', nextReviewDate: new Date(NOW.getTime() + 86400000).toISOString(), lastReviewedAt: NOW.toISOString(), srs: { repetitions: 5, lastRating: 'good' } }),
    makeWord(2, { word: 'bank' }), makeWord(3, { word: 'BANK' }),
    makeWord(4, { definition: '' })
  ];
  const original = structuredClone(words);
  const first = buildDailySession(words, { now: NOW });
  assert.equal(first.exercises.length, 1);
  assert.ok(['w-2', 'w-3'].includes(first.exercises[0].wordId));
  assert.deepEqual(buildDailySession(words, { now: NOW }), first);
  assert.deepEqual(words, original);
});

test('optional manual selection remains available after all scheduled reviews are complete', () => {
  const words = Array.from({ length: 4 }, (_, index) => answer(makeWord(index), true, NOW));
  assert.deepEqual(buildDailySession(words, { now: NOW }).exercises, []);
  assert.equal(selectPracticeWords(words, { now: NOW }).length, 4);
});
