import test from 'node:test';
import assert from 'node:assert/strict';
import { fullFrameGeometry, fullFrameImage } from '../js/services/imagePreprocessing.js';

test('full-frame preprocessing keeps wide, tall and small images without zooming or distortion', () => {
  assert.deepEqual(fullFrameGeometry(1600, 900), { width: 256, height: 144, left: 0, top: 56, size: 256 });
  assert.deepEqual(fullFrameGeometry(900, 1600), { width: 144, height: 256, left: 56, top: 0, size: 256 });
  assert.deepEqual(fullFrameGeometry(40, 20), { width: 40, height: 20, left: 108, top: 118, size: 256 });
  assert.throws(() => fullFrameGeometry(0, 2));
});
test('pixels at both image edges survive padding; transparent pixels use the same neutral background', async () => {
  class Raw { constructor(data, width, height, channels) { Object.assign(this, { data, width, height, channels }); } async resize() { return this; } }
  const source = new Raw(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1, 4);
  const image = await fullFrameImage(source, Raw, 4);
  const pixel = (x, y) => [...image.data.slice((y * 4 + x) * 3, (y * 4 + x) * 3 + 3)];
  assert.deepEqual(pixel(1, 1), [255, 0, 0]); assert.deepEqual(pixel(2, 1), [128, 128, 128]);
  assert.deepEqual(pixel(0, 0), [128, 128, 128]);
});
