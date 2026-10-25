import test from 'node:test';
import assert from 'node:assert/strict';
import { fsrs, createEmptyCard, Rating, FSRSVersion } from 'ts-fsrs';
import { FSRS_DEFAULT_WEIGHTS, readFsrsConfig, reviewChannel, serializeFsrsCard } from '../js/services/fsrsConfig.js';
import { scheduleWordReview, getRatingPreviews, replayWordFsrsHistory } from '../js/services/srsEngine.js';
import { applyExerciseResultToWord, recordExerciseResult, scoreExerciseEvidence } from '../js/services/exerciseResult.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { ReviewHistoryStore, mergeReviewEvents } from '../js/services/reviewHistory.js';
import { optimizeFsrsChannel, predictReviewHistory, predictionMetrics } from '../js/services/fsrsOptimizer.js';
import { memoryContextFeatures, MEMORY_FEATURE_NAMES } from '../js/services/memoryFeatures.js';
import { sourceDefinitionFingerprint } from '../js/services/learningDefinitions.js';
import { syntheticMemoryHistory } from './fixtures/fsrsHistory.mjs';
const NOW = new Date('2026-10-22T10:00:00Z');
const word = { id: 'memory-word', word: 'restrain', partOfSpeech: 'verb', definition: 'To stop someone from acting or moving freely.', createdAt: NOW.toISOString(), nextReviewDate: NOW.toISOString() };
const answer = overrides => ({ wordId: word.id, exerciseType: 'typed-recall', correct: true, producedUnaided: true, recallType: 'free-recall', hintsUsed: 0, occurredAt: NOW.toISOString(), ...overrides });

test('the pinned runtime implements FSRS-6 and all 21 default parameters', () => {
  assert.match(FSRSVersion, /FSRS-6/);assert.equal(FSRS_DEFAULT_WEIGHTS.length, 21);
  const official = fsrs({ maximum_interval: 365, enable_fuzz: false });
  for (const [name, grade] of [['again', Rating.Again], ['hard', Rating.Hard], ['good', Rating.Good], ['easy', Rating.Easy]]) {
    const expected = official.next(createEmptyCard(NOW), NOW, grade).card;
    const scheduled = scheduleWordReview(word, name, { now: NOW });
    assert.deepEqual(scheduled.srs.cards.recall, serializeFsrsCard(expected));
    assert.equal(scheduled.nextReviewDate, expected.due.toISOString());
  }
});

test('recognition and hinted success cannot extend or strengthen an established recall memory', () => {
  let current = applyExerciseResultToWord(word, answer()).word;
  current = applyExerciseResultToWord(current, answer({ occurredAt: current.nextReviewDate })).word;
  const original = structuredClone(current.srs.cards.recall);
  for (const extra of [{ recallType: 'recognition', producedUnaided: false }, { hintsUsed: 1 }]) {
    const next = applyExerciseResultToWord(current, answer({ ...extra, occurredAt: new Date(+NOW + 3600000).toISOString() })).word;
    assert.deepEqual(next.srs.cards.recall, original);assert.equal(next.nextReviewDate, current.nextReviewDate);
  }
  assert.equal(reviewChannel(answer({ recallType: 'context', producedUnaided: false })), 'recognition');
  assert.equal(reviewChannel(answer({ recallType: 'productive' })), 'recall');
});

test('Good is the automatic success grade; phone latency cannot create Hard or speed-only Easy', () => {
  assert.equal(scoreExerciseEvidence(answer({ responseTimeMs: 1000 }), word).rating, 'good');
  assert.equal(scoreExerciseEvidence(answer({ responseTimeMs: 50000 }), word).rating, 'good');
  assert.equal(scoreExerciseEvidence(answer({ responseTimeMs: 110000 }), word).rating, 'good');
  assert.equal(scoreExerciseEvidence(answer({ confidence: 0.2 }), word).rating, 'hard');
  assert.equal(scoreExerciseEvidence(answer({ responseTimeMs: 2000, confidence: 0.95 }), word).rating, 'easy');
  assert.equal(scoreExerciseEvidence(answer({ correct: false, confidence: 1 }), word).rating, 'again');
});

test('rating previews use the same FSRS parameters and evidence channel as the submitted rating', () => {
  const settings = { fsrs: { retention: 0.95, maximumInterval: 180 } };
  const context = { recallType: 'free-recall', hintsUsed: 1, producedUnaided: false };
  const previews = getRatingPreviews(word, NOW, { settings, result: context });
  for (const rating of Object.keys(previews)) assert.equal(previews[rating].nextReviewDate, scheduleWordReview(word, rating, { now: NOW, settings, result: { ...context, correct: rating !== 'again' } }).nextReviewDate);
});

test('each result stores a dated observation with prior features and duplicate IDs are idempotent', async () => {
  const persistence = new DriveSyncService(new MemoryStorage());
  persistence.saveWords([{ ...word, monthYear: 'October 2026' }]);
  const input = answer({ id: 'explicit-result', responseTimeMs: 7123, confidence: 0.8, sessionId: 'session', position: 4 });
  recordExerciseResult(input, persistence);
  const result = recordExerciseResult(input, persistence);assert.equal(result.duplicate, true);
  const events = await persistence.getReviewEvents();
  assert.equal(events.length, 1);const event = events[0];
  assert.equal(event.senseId, sourceDefinitionFingerprint(word));assert.equal(event.responseTimeMs, 7123);assert.equal(event.confidence, 0.8);
  assert.equal(event.sessionId, 'session');assert.equal(event.position, 4);assert.equal(event.channel, 'recall');
  assert.equal(event.context.length, MEMORY_FEATURE_NAMES.length);assert.equal(event.context[8], 0);
  assert.equal(event.memory.before.reps, 0);assert.equal(event.memory.after.reps, 1);
  assert.equal(persistence.getWords()[0].practiceStats.attempts, 1);
  const restarted = new ReviewHistoryStore(persistence.storage, undefined);assert.equal((await restarted.all()).length, 1);
});

test('history union preserves distinct offline events and replay reconstructs all channel memories', () => {
  const first = applyExerciseResultToWord(word, answer({ id: 'first' }));
  const second = applyExerciseResultToWord(word, answer({ id: 'second', occurredAt: new Date(+NOW + 86400000).toISOString() }));
  const event = applied => ({ ...applied.result, wordId: word.id, senseId: sourceDefinitionFingerprint(word), channel: applied.transition.channel,
    grade: applied.transition.grade, memory: applied.transition, context: memoryContextFeatures(word, NOW) });
  const a = [event(first)], b = [event(second)];
  const union = mergeReviewEvents(a, b, a);
  assert.equal(union.length, 2);assert.deepEqual(union, mergeReviewEvents(b, a));
  const replayed = replayWordFsrsHistory(second.word, union, {}, { sourceFingerprint: sourceDefinitionFingerprint(word) });
  assert.equal(replayed.srs.cards.recall.reps, 2);
  assert.equal(replayWordFsrsHistory(second.word, union, {}, { sourceFingerprint: 'different-sense' }), second.word);
});

test('personal fitting waits for sufficient spaced, diverse history instead of fitting same-day clicks', () => {
  const history = syntheticMemoryHistory({ words: 10, rounds: 6 });
  const outcome = optimizeFsrsChannel(history, 'recall');assert.equal(outcome.accepted, false);assert.match(outcome.reason, /400 spaced/);
  const sameDay = history.map(event => ({ ...event, occurredAt: history[0].occurredAt, memory: { ...event.memory, before: { ...event.memory.before, last_review: history[0].occurredAt } } }));
  assert.equal(optimizeFsrsChannel(sameDay, 'recall').eligible, 0);
});

test('real FSRS equations fit a controlled synthetic memory population and improve chronological holdout predictions', () => {
  const events = syntheticMemoryHistory({ words: 120, rounds: 35 });
  const progress = [];
  const result = optimizeFsrsChannel(events, 'recall', null, { progress: detail => progress.push(detail) });
  assert.equal(progress.length, 4);assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.model.weights.length, 21);assert.ok(result.changedParameters > 0);assert.ok(result.deltaL2 > 0);
  assert.ok(result.after.logLoss < result.before.logLoss);assert.ok(result.validationReviews >= 60);
  assert.equal(optimizeFsrsChannel(events, 'recall', result.model).reason, 'No new review history.');
  const baseline = predictionMetrics(predictReviewHistory(events, FSRS_DEFAULT_WEIGHTS));assert.ok(baseline.count > 400);
  assert.deepEqual(readFsrsConfig({ fsrs: { models: { recall: result.model } } }).models.recall.weights, result.model.weights);
});

test('fitting rejects a candidate whose held-out Brier score worsens despite lower log loss', () => {
  const result = optimizeFsrsChannel(syntheticMemoryHistory(), 'recall');
  assert.equal(result.accepted, false);assert.equal(result.model, undefined);
  assert.ok(result.after.logLoss < result.before.logLoss);
  assert.ok(result.after.brier > result.before.brier + 0.001);
});

test('the context calibration learns from prior features and remains bounded', async () => {
  const { fitMemoryCalibration } = await import('../js/services/fsrsOptimizer.js');
  const { calibratedRecallProbability } = await import('../js/services/memoryFeatures.js');
  const cases = Array.from({ length: 1000 }, (_, index) => {
    const difficult = index % 2 === 0;
    const context = memoryContextFeatures({ word: difficult ? 'ambiguous' : 'cat', partOfSpeech: difficult ? 'verb' : 'noun' }, NOW);
    return { probability: 0.9, correct: difficult ? index % 10 < 6 : true, event: { context } };
  });
  const weights = fitMemoryCalibration(cases.slice(0, 800));
  assert.ok(weights.some(value => Math.abs(value) > 1e-6));
  const before = predictionMetrics(cases.slice(800));const after = predictionMetrics(cases.slice(800), weights);
  assert.ok(after.logLoss < before.logLoss);
  const p = calibratedRecallProbability(0.9, cases[0].event.context, weights);
  assert.ok(p >= 0.845 && p <= 0.938);
  const initial = memoryContextFeatures(word, NOW);
  assert.equal(initial.length, MEMORY_FEATURE_NAMES.length);
  assert.deepEqual(initial, memoryContextFeatures({ ...word, learnerResponse: 'never a predictor', currentCorrect: true }, NOW));
});
