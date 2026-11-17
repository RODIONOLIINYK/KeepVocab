import test from 'node:test';
import assert from 'node:assert/strict';
import { createInferenceTimings, getInferenceTimings, recordInferenceTimings } from '../js/services/inferenceTimings.js';

test('inference diagnostics separate initialization and first/later forwards without changing results', async () => {
  let clock = 0;
  const timer = createInferenceTimings('clip', { now: () => clock });
  const operation = async () => { clock += 5; return 42; };
  assert.equal(await timer.measure('initialize', operation), 42);
  assert.equal(await timer.measure('image-forward', operation, { batch: 2 }), 42);
  await timer.measure('image-forward', operation, { batch: 1 });
  const rows = timer.drain();
  assert.deepEqual(rows.map(row => [row.stage, row.ms, row.first]), [
    ['initialize', 5, undefined], ['image-forward', 5, true], ['image-forward', 5, false]
  ]);
  assert.deepEqual(timer.drain(), []);
  await assert.rejects(timer.measure('text-forward', async () => { throw new Error('backend failure'); }), /backend/);
  assert.equal(timer.drain()[0].first, true);
});

test('timing storage is bounded and keeps only scalar diagnostics', async () => {
  const timer = createInferenceTimings('meaning', { now: () => 1 });
  for (let i = 0; i < 100; i++) await timer.measure('meaning-forward', async () => 0, { batch: 8 });
  const rows = timer.drain(); assert.equal(rows.length, 64);
  recordInferenceTimings(rows.map(row => ({ ...row, text: 'private definition', url: 'private image' })));
  recordInferenceTimings([{ model: 'clip', stage: 'other', ms: 5 }, { model: 'clip', stage: 'initialize', ms: NaN }]);
  const recent = getInferenceTimings(); assert.equal(recent.length, 64);
  assert.ok(recent.every(row => !('text' in row) && !('url' in row)));
  recent[0].ms = -1; assert.equal(getInferenceTimings()[0].ms, 0);
});
