import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DAY_MS, formatInterval, getDueWords, getRatingPreviews, migrateSrsState, scheduleWordReview } from '../js/services/srsEngine.js';
import { applyExerciseResultToWord, scoreExerciseEvidence } from '../js/services/exerciseResult.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

function word(overrides = {}) {
  return {
    id: 'w-test',
    word: 'resilient',
    definition: 'able to recover quickly',
    box: 1,
    mastered: false,
    createdAt: '2026-08-01T12:00:00.000Z',
    nextReviewDate: '2026-08-14T11:00:00.000Z',
    ...overrides
  };
}

test('Box 5 mastered words return when their review date arrives', () => {
  const masteredDue = word({ box: 5, mastered: true, nextReviewDate: '2026-08-14T11:59:00.000Z' });
  const masteredLater = word({ id: 'later', box: 5, mastered: true, nextReviewDate: '2026-09-14T12:00:00.000Z' });
  assert.deepEqual(getDueWords([masteredDue, masteredLater], NOW).map(item => item.id), ['w-test']);
});

test('a failed mastered word loses mastered status and becomes reviewable soon', () => {
  const failed = scheduleWordReview(word({ box: 5, mastered: true, srs: { stabilityDays: 45, difficulty: 4, repetitions: 8, lapses: 0 } }), 'again', { now: NOW, evidenceStrength: 0.85 });
  assert.equal(failed.box, 1);
  assert.equal(failed.mastered, false);
  assert.equal(failed.srs.lapses, 1);
  assert.ok(new Date(failed.nextReviewDate) - NOW >= 60_000);
  assert.ok(new Date(failed.nextReviewDate) - NOW <= 10 * 60_000);
});

test('rating labels are derived from the exact schedule they describe', () => {
  const target = word({ box: 2, srs: { stabilityDays: 3, difficulty: 5, repetitions: 2, lapses: 0 } });
  const previews = getRatingPreviews(target, NOW);
  for (const [rating, preview] of Object.entries(previews)) {
    const strength = { again: 0.55, hard: 0.42, good: 0.68, easy: 0.9 }[rating];
    const scheduled = scheduleWordReview(target, rating, { now: NOW, evidenceStrength: strength });
    assert.equal(preview.nextReviewDate, scheduled.nextReviewDate);
    assert.equal(preview.label, formatInterval(new Date(scheduled.nextReviewDate) - NOW));
  }
});

test('legacy data migrates without destroying box, mastery, or review date', () => {
  const legacy = word({ box: 4, mastered: true, nextReviewDate: '2026-08-20T12:00:00.000Z' });
  const migrated = migrateSrsState(legacy, NOW);
  assert.equal(migrated.box, 4);
  assert.equal(migrated.mastered, true);
  assert.equal(migrated.nextReviewDate, legacy.nextReviewDate);
  assert.equal(migrated.srs.version, 2);
  assert.equal(migrated.srs.stabilityDays, 14);
});

test('free production is stronger evidence than multiple choice', () => {
  const recognition = scoreExerciseEvidence({ wordId: 'w', exerciseType: 'choose-word', correct: true, recallType: 'recognition' });
  const production = scoreExerciseEvidence({ wordId: 'w', exerciseType: 'use-it', correct: true, recallType: 'productive', producedUnaided: true });
  assert.ok(production.evidenceStrength > recognition.evidenceStrength);
  assert.equal(recognition.rating, 'hard');
  assert.equal(production.rating, 'easy');
});

test('central results update adaptive scheduling, mastery, and mistakes together', () => {
  const failed = applyExerciseResultToWord(word(), { wordId: 'w-test', exerciseType: 'choose-word', correct: false, recallType: 'recognition', confusedWithWordId: 'w-other', occurredAt: NOW.toISOString() });
  assert.equal(failed.word.mistakes.incorrectAttempts, 1);
  assert.equal(failed.word.mistakes.confusions['w-other'], 1);
  assert.equal(failed.word.srs.lastRating, 'again');
  const recovered = applyExerciseResultToWord(failed.word, { wordId: 'w-test', exerciseType: 'typed-review', correct: true, recallType: 'free-recall', producedUnaided: true, occurredAt: new Date(NOW.getTime() + DAY_MS).toISOString() });
  assert.equal(recovered.word.mistakes.consecutiveFailures, 0);
  assert.ok(recovered.word.mastery.recall > 0);
});

test('learning modes report outcomes through the centralized result API', async () => {
  const files = ['ReviewView.js', 'PracticeModes.js', 'VisualMatchMode.js', 'MatchSprintMode.js', 'FlashcardsMode.js', 'ContextQuizMode.js', 'DailySessionMode.js', 'UseItMode.js'];
  for (const file of files) {
    const source = await readFile(new URL(`../js/components/${file}`, import.meta.url), 'utf8');
    assert.match(source, /recordExerciseResult/);
    assert.doesNotMatch(source, /updateWordRepetition/);
  }
});
