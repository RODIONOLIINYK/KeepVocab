import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js?v=18908';
import { initializeImageLearning, enableImageLearning, disableImageLearning, getImageLearningStatus,
  rankImagesLocally, subscribeImageLearning } from '../js/services/imageLearning.js?v=18908';
import { mountImageReview } from '../js/components/ImageReview.js';
import { CLIP_TAG, CLIP_DIMENSION } from '../js/ml/clipConfig.js';

class ReviewContainer {
  innerHTML = '';
  listeners = new Map();
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
  contains() { return true; }
  click(action) {
    const button = { dataset: { imageReviewAction: action, imageReviewIndex: '0', imageReviewCandidate: '0' } };
    return this.listeners.get('click')?.({ target: { closest: () => button } });
  }
}

const meaning = { id: 'river', word: 'bank', definition: 'Land beside a river.', partOfSpeech: 'noun' };
const photo = { url: 'https://images.example/river.jpg', title: 'A river bank' };

async function setup(context) {
  const original = { storage: globalThis.localStorage, Worker: globalThis.Worker };
  const cleanup = [];
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true, downloadConsent: 'accepted' }));
  await initializeImageLearning({ cacheStorage: { keys: async () => [] } });
  context.after(() => {
    for (const release of cleanup) release();
    disableImageLearning();
    if (original.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = original.storage;
    if (original.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = original.Worker;
  });
  return cleanup;
}

test('the chooser stays usable without exposing installation or training state', async context => {
  const cleanup = await setup(context);
  assert.equal(getImageLearningStatus().enabled, true);
  assert.equal(getImageLearningStatus().installed, false);
  const container = new ReviewContainer();
  const controller = mountImageReview(container, [{ ...meaning, imageCandidates: [{ ...photo,
    ml: { model: CLIP_TAG, score: .4, trainedLabels: 52 }
  }] }]);
  cleanup.push(() => controller.destroy());
  assert.match(container.innerHTML, /Choose an image/);
  assert.doesNotMatch(container.innerHTML, /learning|model|trained|labels|parameters|Settings|confidence|uncertain/i);
  await container.click('choose');
  assert.match(container.innerHTML, /aria-checked="true"/);
});

test('background download progress leaves the chosen photo and picker markup untouched', async context => {
  const cleanup = await setup(context);
  let finishLoading;
  globalThis.Worker = class {
    postMessage(data) {
      finishLoading = () => {
        this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        this.onmessage({ data: { id: data.id, result: { backend: 'wasm' } } });
      };
    }
    terminate() {}
  };
  const container = new ReviewContainer();
  const controller = mountImageReview(container, [{ ...meaning, imageCandidates: [photo] }]);
  cleanup.push(() => controller.destroy());
  await container.click('choose');
  const selectedMarkup = container.innerHTML;
  disableImageLearning();
  assert.equal(container.innerHTML, selectedMarkup);
  const loading = enableImageLearning({ allowMetered: true });
  assert.equal(container.innerHTML, selectedMarkup);
  finishLoading();
  await loading;
  assert.equal(getImageLearningStatus().installed, true);
  assert.equal(container.innerHTML, selectedMarkup);
  controller.destroy();
  disableImageLearning();
  assert.equal(container.innerHTML, selectedMarkup);
});

test('lazy local scoring marks the model installed when its worker becomes ready, without a Settings enable action', async context => {
  const cleanup = await setup(context);
  const messages = [];
  const states = [];
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, index) => Number(index === axis));
  cleanup.push(subscribeImageLearning(state => states.push(state)));
  globalThis.Worker = class {
    postMessage(data) {
      messages.push(data.type);
      queueMicrotask(() => {
        if (data.type === 'texts') this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        const result = data.type === 'texts' ? data.payload.texts.map((_, index) => vector(index ? 1 : 0)) : vector(0);
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const images = await rankImagesLocally(meaning, [photo], {
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }),
    resize: () => assert.fail('The test image already fits the thumbnail limit')
  });
  assert.deepEqual(messages, ['texts', 'image']);
  assert.equal(images[0].ml.model, CLIP_TAG);
  assert.ok(Number.isFinite(images[0].ml.score));
  assert.equal(getImageLearningStatus().enabled, true);
  assert.equal(getImageLearningStatus().installed, true);
  assert.ok(states.some(state => state.phase === 'ready' && state.installed === true));
});

test('CLIP scores all forty-five scene candidates and rejects failures before display', async context => {
  await setup(context); let imageCalls = 0;
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
  globalThis.Worker = class {
    postMessage(data) {
      let result;
      if (data.type === 'texts') result = data.payload.texts.map((_, i) => vector(i ? 1 : 0));
      else {
        const index = imageCalls++;
        result = index === 44 ? vector(1) : vector(index + 2).map((value, i) => i === 0 ? .6 : value * .8);
      }
      queueMicrotask(() => {
        if (data.type === 'texts') this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const candidates = Array.from({ length: 45 }, (_, i) => ({ url: `https://clip45.test/${i}.jpg`, title: `River scene ${i}`, visualScene: `scene ${i % 3}` }));
  const results = await rankImagesLocally(meaning, candidates, {
    fetchImpl: async () => new Response('pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }), resize: () => assert.fail('Small images need no resize')
  });
  assert.equal(imageCalls, 45);
  assert.equal(results.length, 44);
  assert.ok(!results.some(image => image.url === candidates[44].url));
});

test('production local scoring returns nine closest failed matches as manual-only review candidates', async context => {
  const cleanup = await setup(context);
  let imageCalls = 0;
  const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, i) => Number(i === axis));
  globalThis.Worker = class {
    postMessage(data) {
      let result;
      if (data.type === 'texts') result = data.payload.texts.map((_, i) => vector(i ? 1 : 0));
      else {
        const index = imageCalls++, similarity = .1 + index * .005;
        result = Array(CLIP_DIMENSION).fill(0); result[0] = similarity; result[1] = .2;
        result[index + 2] = Math.sqrt(1 - similarity ** 2 - .2 ** 2);
      }
      queueMicrotask(() => {
        if (data.type === 'texts') this.onmessage({ data: { type: 'status', phase: 'ready', backend: 'wasm' } });
        this.onmessage({ data: { id: data.id, result } });
      });
    }
    terminate() {}
  };
  const candidates = Array.from({ length: 12 }, (_, i) => ({ url: `https://fallback-review.test/${i}.jpg` }));
  const images = await rankImagesLocally(meaning, candidates, {
    fetchImpl: async () => new Response('fixture pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }), resize: () => assert.fail('No resize needed')
  });
  assert.equal(imageCalls, 12); assert.equal(images.length, 9);
  assert.deepEqual(images.map(image => image.url), candidates.slice(3).reverse().map(image => image.url));
  assert.ok(images.every(image => image.ml.belowThreshold && image.ml.selected < .19));
  assert.ok(images.every((image, i) => !i || image.ml.cosine <= images[i - 1].ml.cosine));
  const container = new ReviewContainer();
  const review = mountImageReview(container, [{ ...meaning, imageCandidates: images }]);
  cleanup.push(() => review.destroy());
  assert.match(container.innerHTML, /No images passed the match threshold/);
  assert.doesNotMatch(container.innerHTML, /aria-checked="true"/);
  await container.click('choose');
  assert.match(container.innerHTML, /aria-checked="true"/);
});
