import test from 'node:test';
import assert from 'node:assert/strict';

import { completedExercisesToday } from '../js/services/learningStats.js';

test('daily progress counts answered questions without requiring session completion', () => {
  const now = new Date(2026, 7, 20, 12, 0, 0);
  assert.equal(completedExercisesToday({ reviewsDate: '2026-08-20', reviewsToday: 3, learningStats: { sessionHistory: [] } }, now), 3);
  assert.equal(completedExercisesToday({ reviewsDate: '2026-08-19', reviewsToday: 9 }, now), 0);
});
