import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelDownload, paintModelProgress } from '../js/services/modelDownloadProgress.js';

test('download progress reports increasing bytes and preserves streamed contents', async () => {
  const updates = [], parts = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
  const stream = new ReadableStream({ pull(controller) { parts.length ? controller.enqueue(parts.shift()) : controller.close(); } });
  const bytes = await readModelDownload(new Response(stream), { total: 5, onProgress: value => updates.push(value) });
  assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3, 4, 5]);
  assert.equal(updates.at(-1).loaded, 5); assert.equal(updates.at(-1).total, 5);
  assert.ok(updates.every((row, i) => !i || row.loaded >= updates[i - 1].loaded));
});
test('both model progress displays distinguish transfer, preparation and ready states', () => {
  const progress = { removeAttribute(name) { delete this[name]; } }, label = {};
  const element = { querySelector: selector => selector === 'progress' ? progress : label };
  paintModelProgress(element, { phase: 'downloading', downloadProgress: { stage: 'downloading', loaded: 50_000_000, total: 100_000_000 } });
  assert.equal(progress.value, 50_000_000); assert.match(label.textContent, /^50%/); assert.equal(element.hidden, false);
  paintModelProgress(element, { phase: 'loading', downloadProgress: { stage: 'verifying' } });
  assert.equal(progress.value, undefined); assert.equal(label.textContent, 'Verifying download…');
  paintModelProgress(element, { phase: 'ready' }); assert.equal(element.hidden, true);
});
