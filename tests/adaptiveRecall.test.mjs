import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExerciseResultToWord } from '../js/services/exerciseResult.js';
import { getScheduledPracticeWords, normalizeWordPracticeStats } from '../js/services/wordSelection.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { buildDailySession, practiceSessionSize } from '../js/services/dailySession.js';
import { DAY_MS, migrateSrsState } from '../js/services/srsEngine.js';

const NOW = new Date('2026-10-05T10:00:00Z');
const word = (id, overrides = {}) => ({ id, word: `term-${id}`, definition: `meaning-${id}`,
  box: 1, createdAt: new Date(NOW - DAY_MS).toISOString(), nextReviewDate: NOW.toISOString(), ...overrides });
const answer = (item, now, overrides = {}) => applyExerciseResultToWord(item, {
  wordId: item.id, exerciseType: 'daily-typed-recall', recallType: 'free-recall',
  correct: true, producedUnaided: true, hintsUsed: 0, responseTimeMs: 3000,
  occurredAt: now.toISOString(), ...overrides
}).word;

test('recall evidence separates recognition, assistance, and independent retrieval without storing answers', () => {
  let item = answer(word('a'), NOW, { recallType: 'recognition', producedUnaided: false });
  item = answer(item, NOW, { hintsUsed: 1 });
  item = answer(item, NOW);
  item = answer(item, NOW, { responseTimeMs: 9000 });
  let stats = normalizeWordPracticeStats(item);
  assert.equal(stats.recalled, 4);
  assert.equal(stats.recognitionCorrect, 1);
  assert.equal(stats.assistedCorrect, 1);
  assert.equal(stats.unaidedRecalled, 2);
  assert.equal(stats.successfulRecallDays, 1);
  assert.equal(stats.recallAttempts, 3);
  assert.equal(stats.recallTimeTotalMs / stats.timedRecallCount, 6000);
  assert.equal(stats.hintsUsed, 1);
  assert.ok(stats.recentResults.every(result => !('learnerResponse' in result)));
  item = answer(item, new Date(+NOW + DAY_MS));
  stats = normalizeWordPracticeStats(item);
  assert.equal(stats.successfulRecallDays, 2);
});

test('repeated same-day success never buys a multi-day gap or falsely marks a word mastered', () => {
  let item = word('a');
  for (let i = 0; i < 10; i++) item = answer(item, NOW);
  assert.equal(item.practiceStats.successfulRecallDays, 1);
  assert.ok(Date.parse(item.nextReviewDate) - NOW <= DAY_MS);
  assert.equal(item.mastered, false);
  assert.equal(migrateSrsState(item, NOW).mastered, false);
});

test('independent recall on separate days grows intervals; mistakes reset to a short retry', () => {
  let item = word('a');
  const intervals = [];
  for (let day = 0; day < 6; day++) {
    const now = day ? new Date(item.nextReviewDate) : NOW;
    item = answer(item, now);
    intervals.push((Date.parse(item.nextReviewDate) - now) / DAY_MS);
  }
  assert.equal(intervals[0], 1);
  assert.ok(intervals[1] > intervals[0]);
  assert.ok(intervals[2] > intervals[1]);
  assert.ok(intervals[5] > intervals[2]);
  const now = new Date(item.nextReviewDate);
  const failed = answer(item, now, { correct: false, producedUnaided: false });
  assert.ok(Date.parse(failed.nextReviewDate) - now <= 10 * 60000);
  assert.equal(failed.practiceStats.successfulRecallDays, 6);
  assert.equal(failed.practiceStats.missed, 1);
  assert.equal(failed.mastered, false);
});

test('hints and visual recognition produce shorter gaps than independent recall', () => {
  const trained = word('a', { practiceStats: { version: 2, successfulRecallDays: 5, unaidedRecalled: 5 },
    srs: { version: 3, stabilityDays: 8, repetitions: 5 } });
  const independent = answer(trained, NOW);
  const assisted = answer(trained, NOW, { hintsUsed: 1 });
  const recognized = answer(trained, NOW, { recallType: 'recognition', producedUnaided: false });
  assert.ok(Date.parse(independent.nextReviewDate) > Date.parse(assisted.nextReviewDate));
  assert.ok(Date.parse(independent.nextReviewDate) > Date.parse(recognized.nextReviewDate));
  assert.ok(Date.parse(recognized.nextReviewDate) - NOW <= DAY_MS);
});

test('learning top-ups expand a short session after 24 hours while keeping due reviews first', () => {
  const yesterday = new Date(+NOW - DAY_MS);
  const learning = answer(word('learning'), yesterday);
  learning.nextReviewDate = new Date(+NOW + 3 * DAY_MS).toISOString();
  const recent = answer(word('recent'), new Date(+NOW - 2 * 3600000));
  const mature = { ...learning, id: 'mature', word: 'mature', box: 5, mastered: true };
  const waitingMistake = answer(word('waiting'), NOW, { correct: false });
  const words = [word('due'), learning, recent, mature, waitingMistake];
  const original = structuredClone(words);
  const session = buildDailySession(words, { now: NOW });
  assert.deepEqual(session.exercises.map(exercise => exercise.wordId), ['due', 'learning']);
  assert.equal(session.composition.growth, 2);
  assert.deepEqual(buildDailySession(words, { now: NOW, targetSize: 1 }).exercises.map(item => item.wordId), ['due']);
  assert.deepEqual(words, original);
});

test('configured sessions cover up to fifty distinct words and cannot pad a tiny library', () => {
  assert.equal(practiceSessionSize(), 20);
  assert.equal(practiceSessionSize({ practiceSessionSize: 100 }), 50);
  assert.equal(practiceSessionSize({ practiceSessionSize: -1 }), 5);
  const words = Array.from({ length: 70 }, (_, index) => word(String(index)));
  const session = buildDailySession(words, { now: NOW, targetSize: practiceSessionSize({ practiceSessionSize: 40 }) });
  assert.equal(session.exercises.length, 40);
  assert.equal(new Set(session.exercises.map(item => item.wordId)).size, 40);
  assert.equal(buildDailySession(words.slice(0, 3), { now: NOW }).exercises.length, 3);
});

test('bounded result history retains recent failures and recall statistics survive old records', () => {
  let item = word('a', { practiceStats: { version: 1, attempts: 5, recalled: 3, missed: 2 } });
  for (let i = 0; i < 25; i++) item = answer(item, new Date(+NOW + i * DAY_MS), { correct: i % 3 !== 0 });
  assert.equal(item.practiceStats.recentResults.length, 20);
  assert.equal(item.practiceStats.attempts, 30);
  assert.equal(item.practiceStats.recalled + item.practiceStats.missed, 30);
  assert.equal(item.practiceStats.legacySuccessfulReviews, 3);
});

test('established legacy review strength survives the first answer after upgrading', () => {
  const old = word('old', { box: 4, srs: { version: 2, stabilityDays: 14, repetitions: 8, lapses: 2 },
    practiceStats: { version: 1, attempts: 8, recalled: 6, missed: 2 } });
  const updated = answer(old, NOW);
  assert.equal(updated.practiceStats.legacySuccessfulReviews, 6);
  assert.equal(updated.practiceStats.successfulRecallDays, 1);
  assert.ok(Date.parse(updated.nextReviewDate) - NOW > 14 * DAY_MS);
});

test('Practice includes previous notebooks by default, stays in the active language, and supports a month-only preference', () => {
  const persistence = new DriveSyncService(new MemoryStorage());
  persistence.saveWords([
    word('old', { courseId: 'english', monthYear: 'September 2026' }),
    word('new', { courseId: 'english', monthYear: 'October 2026' }),
    word('lt', { courseId: 'lithuanian', monthYear: 'September 2026' })
  ]);
  persistence.updateSettings({ activeNotebook: 'October 2026 Vocabulary', practiceSessionSize: 40 });
  assert.deepEqual(getScheduledPracticeWords(persistence).map(item => item.id), ['old', 'new']);
  persistence.updateSettings({ practiceAllMonths: false });
  assert.deepEqual(getScheduledPracticeWords(persistence).map(item => item.id), ['new']);
  persistence.setActiveCourseId('lithuanian');
  assert.deepEqual(getScheduledPracticeWords(persistence).map(item => item.id), ['lt']);
  assert.equal(persistence.getSettings().practiceSessionSize, 20);
  persistence.setActiveCourseId('english');
  assert.equal(persistence.getSettings().practiceAllMonths, false);
  assert.equal(persistence.getSettings().practiceSessionSize, 40);
});
