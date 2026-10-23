import test from 'node:test';
import assert from 'node:assert/strict';
import { applyExerciseResultToWord, recordExerciseResult } from '../js/services/exerciseResult.js';
import { ensureDailyStudyPlan, evaluateDailyStudyPlan, getScheduledPracticeWords, normalizeWordPracticeStats, selectModeWords } from '../js/services/wordSelection.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { buildDailySession, buildScheduledPracticeSession, practiceSessionSize, selectPracticeWords } from '../js/services/dailySession.js';
import { DAILY_EVALUATION_HOUR, getNextStudyDayStart, getStudyDayStart, localDateKey, studyDayKey } from '../js/utils/dates.js';
import { DAY_MS, migrateSrsState } from '../js/services/srsEngine.js';
import { getPracticeReadiness } from '../js/services/reminderService.js';

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

test('last unaided recall survives failures, recognition, hints, and older incoming answers', () => {
  let item = answer(word('a'), NOW);
  const recalledAt = item.practiceStats.lastUnaidedRecallAt;
  for (const [offset, overrides] of [[1, { correct: false }], [2, { recallType: 'recognition' }], [3, { hintsUsed: 1 }]]) {
    item = answer(item, new Date(+NOW + offset * 60000), overrides);
    assert.equal(item.practiceStats.lastUnaidedRecallAt, recalledAt);
  }
  const latest = structuredClone(item);
  item = answer(item, new Date(+NOW - DAY_MS));
  assert.equal(item.practiceStats.lastUnaidedRecallAt, recalledAt);
  assert.equal(item.practiceStats.lastAnsweredAt, latest.practiceStats.lastAnsweredAt);
  assert.equal(item.practiceStats.successfulRecallDays, 1);
  assert.equal(item.practiceStats.attempts, latest.practiceStats.attempts + 1);
  assert.equal(item.nextReviewDate, latest.nextReviewDate);
  assert.deepEqual(item.lastExerciseResult, latest.lastExerciseResult);
  item = answer(item, new Date(+NOW + DAY_MS));
  assert.equal(item.practiceStats.lastUnaidedRecallAt, new Date(+NOW + DAY_MS).toISOString());
  assert.equal(item.practiceStats.successfulRecallDays, 2);
});

test('old records recover recall dates only from explicit unaided evidence', () => {
  const occurredAt = NOW.toISOString();
  const result = { correct: true, producedUnaided: true, hintsUsed: 0, recallType: 'free-recall', occurredAt };
  assert.equal(normalizeWordPracticeStats(word('old', { lastExerciseResult: result })).lastUnaidedRecallAt, occurredAt);
  for (const overrides of [{ recallType: 'recognition' }, { correct: false }, { hintsUsed: 1 }, { producedUnaided: false }]) {
    assert.equal(normalizeWordPracticeStats(word('old', { lastExerciseResult: { ...result, ...overrides } })).lastUnaidedRecallAt, '');
  }
  assert.equal(normalizeWordPracticeStats(word('old', { lastReviewedAt: occurredAt, srs: { repetitions: 10, lastRating: 'good' } })).lastUnaidedRecallAt, '');
  assert.equal(normalizeWordPracticeStats(word('old', { practiceStats: { lastUnaidedRecallAt: 'invalid', recentResults: [
    { correct: true, unaided: true, recallType: 'productive', occurredAt }
  ] } })).lastUnaidedRecallAt, occurredAt);
});

test('unknown response times do not count as instant recall or strengthen evidence', () => {
  for (const responseTimeMs of [null, undefined, '']) {
    const item = answer(word('a'), NOW, { responseTimeMs });
    assert.equal(item.lastExerciseResult.responseTimeMs, null);
    assert.equal(item.practiceStats.timedRecallCount, 0);
    assert.equal(item.practiceStats.recallTimeTotalMs, 0);
  }
});

test('FSRS same-day learning stays within a short interval and never falsely marks a word mastered', () => {
  let item = word('a');
  for (let i = 0; i < 10; i++) item = answer(item, NOW);
  assert.equal(item.practiceStats.successfulRecallDays, 1);
  assert.ok(Date.parse(item.nextReviewDate) - NOW <= 3 * DAY_MS);
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
  assert.equal(intervals[0], 10 / 1440);
  assert.ok(intervals[1] > intervals[0]);
  assert.ok(intervals[2] > intervals[1]);
  assert.ok(intervals[5] > intervals[2]);
  const now = new Date(item.nextReviewDate);
  const failed = answer(item, now, { correct: false, producedUnaided: false });
  assert.ok(Date.parse(failed.nextReviewDate) - now <= 10 * 60000);
  assert.equal(failed.practiceStats.successfulRecallDays, 5);
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

test('FSRS honors actual due dates instead of adding arbitrary learning top-ups', () => {
  const yesterday = new Date(+NOW - DAY_MS);
  const learning = answer(word('learning'), yesterday);
  learning.nextReviewDate = new Date(+NOW + 3 * DAY_MS).toISOString();
  const recent = answer(word('recent'), new Date(+NOW - 2 * 3600000));
  const mature = { ...learning, id: 'mature', word: 'mature', box: 5, mastered: true };
  const waitingMistake = answer(word('waiting'), NOW, { correct: false });
  const words = [word('due'), learning, recent, mature, waitingMistake];
  const original = structuredClone(words);
  const session = buildDailySession(words, { now: NOW });
  assert.deepEqual(session.exercises.map(exercise => exercise.wordId), ['due', 'recent']);
  assert.equal(session.composition.growth, 1);
  assert.equal(session.composition.due, 1);
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

test('legacy boxes and review dates retain inferred repetition history when SRS statistics are absent', () => {
  const old = word('legacy', { box: 4, lastReviewedAt: new Date(+NOW - 14 * DAY_MS).toISOString() });
  const updated = answer(old, NOW);
  assert.equal(updated.practiceStats.attempts, 4);
  assert.equal(updated.practiceStats.legacySuccessfulReviews, 3);
  assert.equal(updated.practiceStats.successfulRecallDays, 1);
});

test('Practice uses the selected English month, even with a retired all-months setting', () => {
  const persistence = new DriveSyncService(new MemoryStorage());
  persistence.saveWords([
    word('old', { courseId: 'english', monthYear: 'September 2026' }),
    word('new', { courseId: 'english', monthYear: 'October 2026' }),
    word('unsupported', { courseId: 'removed-course', monthYear: 'September 2026' })
  ]);
  persistence.updateSettings({ activeNotebook: 'October 2026 Vocabulary', practiceSessionSize: 40, practiceAllMonths: true });
  assert.deepEqual(getScheduledPracticeWords(persistence).map(item => item.id), ['new']);
  persistence.refreshNotebooks();
  persistence.setActiveNotebook('September 2026 Vocabulary');
  assert.deepEqual(getScheduledPracticeWords(persistence).map(item => item.id), ['old']);
  persistence.updateSettings({ activeNotebook: 'July 2026 Vocabulary' });
  assert.deepEqual(getScheduledPracticeWords(persistence), []);
  assert.throws(() => persistence.setActiveCourseId('removed-course'), /Unknown course/);
  assert.equal(persistence.getActiveNotebook(), 'July 2026 Vocabulary');
  assert.equal(persistence.getSettings().practiceSessionSize, 40);
  assert.equal(persistence.getWords().length, 2);
});

test('a 107-word backlog stays within each batch and remains available after the daily goal', () => {
  const words = Array.from({ length: 107 }, (_, index) => word(String(index)));
  const settings = { dailyGoal: 20, practiceSessionSize: 50, reviewsToday: 7, reviewsDate: localDateKey(NOW) };
  const original = structuredClone({ words, settings });
  assert.equal(buildScheduledPracticeSession(words, {}, { now: NOW }).wordCount, 20);
  assert.equal(buildScheduledPracticeSession(words, settings, { now: NOW }).wordCount, 50);
  assert.equal(buildScheduledPracticeSession(words, { ...settings, practiceSessionSize: 5 }, { now: NOW }).wordCount, 5);
  const done = { ...settings, reviewsToday: 20 };
  const extra = buildScheduledPracticeSession(words, done, { now: NOW });
  assert.equal(extra.dailyGoalComplete, true);
  assert.equal(extra.wordCount, 50);
  assert.equal(extra.exercises.length, 50);
  assert.equal(buildScheduledPracticeSession(words, { ...done, reviewsToday: 107 }, { now: NOW }).wordCount, 50);
  const tomorrow = buildScheduledPracticeSession(words, done, { now: new Date(+NOW + DAY_MS) });
  assert.equal(tomorrow.wordCount, 50);
  assert.equal(tomorrow.dailyGoalComplete, false);
  assert.deepEqual({ words, settings }, original);
});

test('abandoned sessions retain goal progress and shrink today’s 8:00 AM plan instead of refilling from the backlog', () => {
  // getSettings normalizes daily activity to the real local day.
  const activityDate = new Date();
  const persistence = new DriveSyncService(new MemoryStorage());
  const words = Array.from({ length: 30 }, (_, index) => word(String(index), { monthYear: 'October 2026', courseId: 'english' }));
  persistence.saveWords(words);
  persistence.setActiveNotebook('October 2026 Vocabulary');
  const initialSettings = ensureDailyStudyPlan(persistence, { now: activityDate });
  const initial = buildScheduledPracticeSession(getScheduledPracticeWords(persistence), initialSettings, { now: activityDate });
  assert.equal(initial.wordCount, 20);
  const initialIds = new Set(initial.exercises.map(exercise => exercise.wordId));
  const answeredIds = initial.exercises.slice(0, 7).map(exercise => exercise.wordId);
  // Answering 7 words (4 correct, 3 missed on 10m cooldown) shrinks today's remaining ready queue to 13 instead of pulling deferred words from tomorrow's pool.
  for (let i = 0; i < answeredIds.length; i++) recordExerciseResult({ wordId: answeredIds[i], exerciseType: 'daily-typed-recall', recallType: 'free-recall', correct: i % 2 === 0, occurredAt: activityDate.toISOString() }, persistence);
  const settings = persistence.getSettings();
  assert.equal(settings.reviewsToday, 7);
  const next = buildScheduledPracticeSession(getScheduledPracticeWords(persistence), settings, { now: activityDate });
  assert.equal(next.wordCount, 13);
  assert.equal(next.dailyPlan.completedTodayCount, 4);
  assert.equal(next.dailyPlan.remainingTodayCount, 16);
  assert.equal(next.dailyPlan.reviseTomorrowCount, 14);
  assert.equal(next.dailyGoalComplete, false);
  assert.equal(next.exercises.some(exercise => answeredIds.includes(exercise.wordId)), false);
  assert.equal(next.exercises.every(exercise => initialIds.has(exercise.wordId)), true);
});

test('8:00 AM daily evaluation separates reviseToday, learnToday, and reviseTomorrow and locks for the study day', () => {
  assert.equal(DAILY_EVALUATION_HOUR, 8);
  const beforeEight = new Date(2026, 9, 10, 7, 30, 0);
  const afterEight = new Date(2026, 9, 10, 8, 15, 0);
  assert.equal(studyDayKey(beforeEight), '2026-10-09');
  assert.equal(studyDayKey(afterEight), '2026-10-10');
  assert.equal(getStudyDayStart(afterEight).getHours(), 8);
  assert.equal(getNextStudyDayStart(afterEight).getHours(), 8);

  const yesterday = new Date(afterEight.getTime() - DAY_MS);
  const revisedPool = Array.from({ length: 18 }, (_, index) => {
    const reviewed = answer(word(`rev-${index}`), yesterday);
    return { ...reviewed, nextReviewDate: new Date(afterEight.getTime() - (index + 1) * 60000).toISOString() };
  });
  const newPool = Array.from({ length: 12 }, (_, index) => word(`new-${index}`, {
    createdAt: yesterday.toISOString(),
    nextReviewDate: afterEight.toISOString()
  }));
  const allWords = [...revisedPool, ...newPool];
  const plan = evaluateDailyStudyPlan(allWords, { practiceSessionSize: 20 }, { now: afterEight });

  assert.equal(plan.plannedTodayCount, 20);
  assert.equal(plan.reviseTodayCount, 14);
  assert.equal(plan.learnTodayCount, 6);
  assert.equal(plan.reviseTomorrowCount, 10);

  // Completing one word today reduces today's remaining count by 1 without pulling an overflow word from tomorrow.
  const firstTarget = plan.todayWords[0];
  const updatedWords = allWords.map(item => item.id === firstTarget.id ? answer(item, new Date(afterEight.getTime() + 5 * 60000)) : item);
  const afterOne = evaluateDailyStudyPlan(updatedWords, { practiceSessionSize: 20, dailyStudyPlan: plan.snapshot }, { now: new Date(afterEight.getTime() + 5 * 60000) });
  assert.equal(afterOne.completedTodayCount, 1);
  assert.equal(afterOne.remainingTodayCount, 19);
  assert.equal(afterOne.reviseTomorrowCount, 11);

  // Secondary modes (Flashcards, Choose Word, Visual Match, Match Sprint) select from Today's 8:00 AM Study Plan first.
  const plannedIds = new Set(plan.allPlannedTodayWords.map(item => item.id));
  for (const mode of ['flashcards', 'visual-match', 'match-sprint']) {
    const selected = selectModeWords(updatedWords, {
      mode,
      limit: 6,
      now: new Date(afterEight.getTime() + 5 * 60000),
      settings: { practiceSessionSize: 20, dailyStudyPlan: plan.snapshot },
      useDailyPlan: true,
      allowCompletedPlanWords: true
    });
    assert.equal(selected.length, 6);
    assert.equal(selected.every(item => plannedIds.has(item.id)), true);
  }
  const chooseSelected = selectPracticeWords(updatedWords, {
    mode: 'choose-word',
    limit: 10,
    now: new Date(afterEight.getTime() + 5 * 60000),
    settings: { practiceSessionSize: 20, dailyStudyPlan: plan.snapshot },
    useDailyPlan: true,
    allowCompletedPlanWords: true
  });
  assert.equal(chooseSelected.length, 10);
  assert.equal(chooseSelected.every(item => plannedIds.has(item.id)), true);
});

test('completed goals do not pad sessions with recently recalled words after the backlog is cleared', () => {
  const settings = { dailyGoal: 5, practiceSessionSize: 20, reviewsToday: 20, reviewsDate: localDateKey(NOW) };
  const resting = Array.from({ length: 6 }, (_, index) => answer(word(String(index)), NOW));
  const session = buildScheduledPracticeSession(resting, settings, { now: NOW });
  assert.equal(session.dailyGoalComplete, true);
  assert.equal(session.wordCount, 0);
  assert.equal(session.estimatedMinutes, 0);
});

test('imported untouched future reviews wait consistently across Practice, manual modes, and reminders', () => {
  const nextReview = new Date(+NOW + DAY_MS);
  const imported = word('future', { nextReviewDate: nextReview.toISOString() });
  assert.equal(buildScheduledPracticeSession([imported], {}, { now: NOW }).wordCount, 0);
  assert.deepEqual(selectModeWords([imported], { now: NOW }), []);
  const readiness = getPracticeReadiness([imported], NOW);
  assert.equal(readiness.readyNowCount, 0);
  assert.deepEqual(readiness.nextReadyAt, nextReview);
  assert.equal(buildScheduledPracticeSession([imported], {}, { now: nextReview }).wordCount, 1);
  assert.equal(selectModeWords([imported], { now: nextReview }).length, 1);
  assert.equal(getPracticeReadiness([imported], nextReview).readyNowCount, 1);
  const fresh = word('fresh', { createdAt: NOW.toISOString() });
  assert.equal(buildScheduledPracticeSession([fresh], {}, { now: NOW }).wordCount, 1);
  assert.equal(selectModeWords([fresh], { now: NOW }).length, 1);
  assert.equal(getPracticeReadiness([fresh], NOW).readyNowCount, 1);
});
