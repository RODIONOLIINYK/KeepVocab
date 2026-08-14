import test from 'node:test';
import assert from 'node:assert/strict';

import { getInteractionSoundProfile } from '../js/services/interactionSound.js';
import { formatReminderTime, getNextReminderAt, normalizeReminderTime } from '../js/services/reminderService.js';

test('reminder times are normalized and invalid input falls back safely', () => {
  assert.equal(normalizeReminderTime('7:05'), '07:05');
  assert.equal(normalizeReminderTime('23:59'), '23:59');
  assert.equal(normalizeReminderTime('25:00'), '19:00');
});

test('next reminder rolls to tomorrow after the selected time', () => {
  const before = new Date(2026, 7, 14, 18, 30);
  const after = new Date(2026, 7, 14, 20, 30);
  assert.equal(getNextReminderAt('19:00', before).getDate(), 14);
  assert.equal(getNextReminderAt('19:00', after).getDate(), 15);
  assert.match(formatReminderTime('19:00', 'en-US'), /7:00 PM/);
});

test('interaction sounds stay short and use distinct success and error contours', () => {
  const success = getInteractionSoundProfile('success');
  const error = getInteractionSoundProfile('error');
  assert.ok(success.length >= 2);
  assert.ok(success.at(-1).frequency > success[0].frequency);
  assert.ok(error.at(-1).frequency < error[0].frequency);
  assert.ok([...success, ...error].every(tone => tone.duration <= 0.15));
});
