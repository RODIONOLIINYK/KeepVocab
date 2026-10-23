import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextStudyDayStart, getStudyDayStart, studyDayKey } from '../js/utils/dates.js';
import { evaluateDailyStudyPlan } from '../js/services/wordSelection.js';

test('midnight is an accepted study boundary rather than falling back to 8 AM', () => {
  const now = new Date(2026, 9, 10, 1, 30);
  assert.equal(getStudyDayStart(now, 0).getHours(), 0);
  assert.equal(getNextStudyDayStart(now, 0).getHours(), 0);
  assert.equal(studyDayKey(now, 0), '2026-10-10');
});

test('tomorrow remains an 8 AM calendar day across Vilnius daylight saving changes', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Vilnius';
  try {
    for (const [month, day, hours] of [[2, 27, 23], [9, 23, 25]]) {
      const now = new Date(2026, month, day, 12);
      const tomorrow = getNextStudyDayStart(now);
      const followingDay = getNextStudyDayStart(tomorrow);
      assert.equal((followingDay - tomorrow) / 3600000, hours);
      assert.equal(tomorrow.getHours(), 8);
      assert.equal(followingDay.getHours(), 8);
      const word = (id, due) => ({ id, word: id, definition: 'Meaning.',
        createdAt: new Date(2026, month, day - 2, 12).toISOString(), nextReviewDate: due.toISOString(),
        lastReviewedAt: new Date(2026, month, day - 1, 12).toISOString(), srs: { repetitions: 4 } });
      const plan = evaluateDailyStudyPlan([
        word('in-tomorrow', new Date(followingDay - 1)), word('after-tomorrow', followingDay)
      ], {}, { now });
      assert.deepEqual(plan.reviseTomorrow.map(item => item.id), ['in-tomorrow']);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
