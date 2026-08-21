import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { applyExerciseResultToWord } from '../js/services/exerciseResult.js';
import {
  normalizeWordPracticeStats,
  recordModeWordSelections,
  selectModeWords
} from '../js/services/wordSelection.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date('2026-08-21T10:00:00.000Z');

function makeWord(index, overrides = {}) {
  return {
    id: `word-${index}`,
    word: `term${index}`,
    definition: `definition ${index}`,
    createdAt: '2026-07-01T00:00:00.000Z',
    nextReviewDate: '2026-09-21T00:00:00.000Z',
    ...overrides
  };
}

function createPersistence(initialWords) {
  let words = structuredClone(initialWords);
  return {
    getWords: () => structuredClone(words),
    saveWords: next => { words = structuredClone(next); }
  };
}

test('every word stores recalled, missed, streak, timestamp, and per-mode answer statistics', () => {
  let target = makeWord(1);
  target = applyExerciseResultToWord(target, { wordId: target.id, exerciseType: 'flashcards', correct: true, recallType: 'recognition', occurredAt: START.toISOString() }).word;
  target = applyExerciseResultToWord(target, { wordId: target.id, exerciseType: 'visual-match', correct: false, recallType: 'recognition', occurredAt: new Date(START.getTime() + DAY_MS).toISOString() }).word;
  target = applyExerciseResultToWord(target, { wordId: target.id, exerciseType: 'use-it', correct: true, recallType: 'productive', occurredAt: new Date(START.getTime() + 2 * DAY_MS).toISOString() }).word;

  const stats = normalizeWordPracticeStats(target);
  assert.equal(stats.attempts, 3);
  assert.equal(stats.recalled, 2);
  assert.equal(stats.missed, 1);
  assert.equal(stats.consecutiveCorrect, 1);
  assert.equal(stats.lastAnswerCorrect, true);
  assert.equal(stats.byMode.flashcards.recalled, 1);
  assert.equal(stats.byMode['visual-match'].missed, 1);
  assert.equal(stats.byMode['use-it'].attempts, 1);
});

test('legacy SRS repetitions and mistakes become initial per-word answer statistics', () => {
  const stats = normalizeWordPracticeStats(makeWord(1, {
    srs: { repetitions: 7 },
    mistakes: { incorrectAttempts: 3 }
  }));
  assert.equal(stats.attempts, 7);
  assert.equal(stats.recalled, 4);
  assert.equal(stats.missed, 3);
});

test('correctly answered words rotate out instead of occupying the same daily set', () => {
  let words = Array.from({ length: 24 }, (_, index) => makeWord(index));
  const dailySets = [];

  for (let day = 0; day < 3; day += 1) {
    const now = new Date(START.getTime() + day * DAY_MS);
    const selected = selectModeWords(words, { mode: 'flashcards', limit: 6, now });
    dailySets.push(new Set(selected.map(word => word.id)));
    const persistence = createPersistence(words);
    recordModeWordSelections(persistence, selected, { mode: 'flashcards', now });
    words = persistence.getWords().map(word => dailySets[day].has(word.id)
      ? applyExerciseResultToWord(word, { wordId: word.id, exerciseType: 'flashcards', correct: true, recallType: 'recognition', learnerRating: 'good', occurredAt: now.toISOString() }).word
      : word);
  }

  const union = new Set(dailySets.flatMap(set => [...set]));
  assert.equal(dailySets.every(set => set.size === 6), true);
  assert.ok(union.size >= 17, `expected broad rotation, received ${union.size} unique words`);
  assert.equal([...dailySets[0]].filter(id => dailySets[1].has(id)).length, 0);
});

test('recent misses get a bounded focus share and rotate within the difficult group', () => {
  let words = Array.from({ length: 24 }, (_, index) => makeWord(index, index < 6 ? {
    mistakes: { incorrectAttempts: 8, consecutiveFailures: 2, recentFailures: [START.toISOString()] },
    practiceStats: { attempts: 10, recalled: 2, missed: 8, consecutiveMisses: 2, lastAnswerCorrect: false, lastMissedAt: START.toISOString() }
  } : {}));
  const hardIds = new Set(words.slice(0, 6).map(word => word.id));
  const first = selectModeWords(words, { mode: 'visual-match', limit: 10, now: START });
  const firstHard = first.filter(word => hardIds.has(word.id));
  assert.equal(firstHard.length, 3);

  const persistence = createPersistence(words);
  recordModeWordSelections(persistence, first, { mode: 'visual-match', now: START });
  words = persistence.getWords();
  const second = selectModeWords(words, { mode: 'visual-match', limit: 10, now: new Date(START.getTime() + DAY_MS) });
  const secondHard = second.filter(word => hardIds.has(word.id));
  assert.equal(secondHard.length, 3);
  assert.equal(secondHard.some(word => firstHard.some(firstWord => firstWord.id === word.id)), false);
});

test('mode selections are persisted separately from answer counts', () => {
  const words = [makeWord(1), makeWord(2), makeWord(3)];
  const persistence = createPersistence(words);
  recordModeWordSelections(persistence, words.slice(0, 2), { mode: 'match-sprint', now: START });
  const stored = persistence.getWords();
  assert.equal(normalizeWordPracticeStats(stored[0]).byMode['match-sprint'].selections, 1);
  assert.equal(normalizeWordPracticeStats(stored[0]).attempts, 0);
  assert.equal(normalizeWordPracticeStats(stored[2]).selections, 0);
});

test('independent modes use fair rotation while Daily Practice keeps its existing scheduler', async () => {
  for (const file of ['FlashcardsMode.js', 'VisualMatchMode.js', 'MatchSprintMode.js', 'ContextQuizMode.js', 'UseItMode.js', 'SpeakingMode.js']) {
    const source = await readFile(new URL(`../js/components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /wordSelection\.js/);
  }
  const practice = await readFile(new URL('../js/components/PracticeModes.js', import.meta.url), 'utf8');
  const daily = await readFile(new URL('../js/services/dailySession.js', import.meta.url), 'utf8');
  const library = await readFile(new URL('../js/components/LibraryView.js', import.meta.url), 'utf8');
  assert.match(practice, /selectPracticeWords/);
  assert.doesNotMatch(daily, /selectModeWords/);
  assert.match(library, /Recalled.*Missed/s);
});
