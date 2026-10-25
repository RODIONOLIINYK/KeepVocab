import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js?v=18900';
import { initializeImageLearning, enableImageLearning, disableImageLearning, getImageLearningStatus,
  rankImagesLocally, subscribeImageLearning } from '../js/services/imageLearning.js?v=18900';
import { mountImageReview } from '../js/components/ImageReview.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';

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
  const vector = axis => Array.from({ length: 512 }, (_, index) => Number(index === axis));
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
