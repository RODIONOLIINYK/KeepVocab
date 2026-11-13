import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js?v=18908';
import {
  initializeImageLearning,
  warmImageLearning,
  enableImageLearning,
  disableImageLearning,
  clearImageModelDownloads,
  getImageLearningStatus,
  getMeaningTextEncodingStatus,
  checkMeaningTextEncodingStatus,
  encodeDefinitionTextsDetailed,
  encodeDefinitionTexts,
  rankImagesLocally
} from '../js/services/imageLearning.js?v=18908';
import { CLIP_CACHE, CLIP_DOWNLOAD_URLS, CLIP_TAG, CLIP_DIMENSION } from '../js/ml/clipConfig.js';

const CONFIG_KEY = 'keepvocab_image_learning_device_v1';
const vector = axis => Array.from({ length: CLIP_DIMENSION }, (_, index) => Number(index === axis));

function cachedFiles(urls = CLIP_DOWNLOAD_URLS) {
  const entries = new Set(urls);
  return {
    keys: async () => entries.size ? [CLIP_CACHE] : [],
    delete: async name => { if (name === CLIP_CACHE) entries.clear(); return true; },
    open: async () => ({
      keys: async () => [...entries],
      match: async url => entries.has(url)
        ? new Response('cached', { headers: { 'content-length': '6' } })
        : undefined
    })
  };
}

function setupRuntime(context, { config = {}, caches = cachedFiles(), autoAnswer = true } = {}) {
  context.mock.getter(globalThis, 'navigator', () => ({ hardwareConcurrency: 2, onLine: true }));
  const originals = Object.fromEntries(
    ['localStorage', 'caches', 'Worker', 'setTimeout', 'clearTimeout']
      .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  globalThis.caches = caches;
  disableImageLearning();
  storage.setItem(CONFIG_KEY, JSON.stringify(config));

  const workers = [];
  const scheduled = [];
  globalThis.Worker = class {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(data) {
      this.messages.push(data);
      if (data.type === 'cancel') return;
      if (!autoAnswer && data.type === 'initialize') return;
      queueMicrotask(() => this.answer(data));
    }
    answer(data = this.messages.at(-1), response = {}) {
      if (this.terminated) return;
      const result = data.type === 'initialize'
        ? { backend: data.device === 'auto' ? 'webgpu' : 'wasm' }
        : data.type === 'texts'
          ? data.payload.texts.map((_, index) => vector(index % CLIP_DIMENSION))
          : vector(0);
      this.onmessage?.({ data: { id: data.id, result, ...response } });
    }
    terminate() { this.terminated = true; }
  };

  const scheduleWarmup = callback => {
    const job = { callback, cancelled: false };
    scheduled.push(job);
    return () => { job.cancelled = true; };
  };

  context.after(async () => {
    disableImageLearning();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  return { storage, workers, scheduled, scheduleWarmup };
}

test('meaning text encoding uses installed SigLIP2 model when image learning is disabled without changing user setting or allowing downloads', async context => {
  const initialConfig = { enabled: false, prompted: true, downloadConsent: 'declined' };
  const env = setupRuntime(context, { config: initialConfig, caches: cachedFiles() });

  const init = await initializeImageLearning({
    storage: env.storage,
    cacheStorage: cachedFiles(),
    scheduleWarmup: env.scheduleWarmup
  });
  assert.equal(init.installed, true);
  assert.equal(init.enabled, false);
  assert.equal(env.scheduled.length, 0);

  const preStatus = await checkMeaningTextEncodingStatus({ storage: env.storage, cacheStorage: cachedFiles() });
  assert.equal(preStatus.available, true);
  assert.equal(preStatus.status, 'installed');
  assert.equal(preStatus.imageLearningEnabled, false);
  assert.equal(preStatus.model, CLIP_TAG);

  const detail = await encodeDefinitionTextsDetailed(['A swift river current.', 'A stream of water.'], {
    storage: env.storage,
    cacheStorage: cachedFiles()
  });
  assert.equal(detail.ok, true);
  assert.equal(detail.status, 'ready');
  assert.equal(detail.available, true);
  assert.equal(detail.ready, true);
  assert.equal(detail.model, CLIP_TAG);
  assert.equal(detail.vectors.length, 2);

  // Worker was reused without enabling image ranking or altering user preference
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].messages[0].type, 'texts');
  assert.equal(env.workers[0].messages[0].allowDownloads, false);
  assert.deepEqual(JSON.parse(env.storage.getItem(CONFIG_KEY)), initialConfig);
  assert.equal(getImageLearningStatus().phase, 'off');
  assert.equal(getImageLearningStatus().enabled, false);

  // Subsequent text call reuses the same worker
  const second = await encodeDefinitionTexts(['A third gloss.'], { storage: env.storage, cacheStorage: cachedFiles() });
  assert.equal(second.length, 1);
  assert.equal(env.workers.length, 1);

  // Image requests stay disabled when image learning is off
  const candidate = { url: 'https://images.example/river.jpg', title: 'River' };
  const ranked = await rankImagesLocally({ word: 'flow', definition: 'A stream of water.' }, [candidate], {
    storage: env.storage,
    fetchImpl: () => assert.fail('Disabled image ranking must not fetch candidate images')
  });
  assert.deepEqual(ranked, [candidate]);
  assert.equal((await warmImageLearning({ storage: env.storage })).phase, 'off');
  assert.equal(env.workers[0].messages.filter(m => m.type === 'image').length, 0);

  // Enabling image learning later reuses the already-loaded worker (no duplicate model)
  await enableImageLearning({ storage: env.storage, download: false });
  assert.equal(env.workers.length, 1);
  assert.equal(getImageLearningStatus().phase, 'ready');
});

test('missing or incomplete cache reports explicit not-installed status and never spawns a worker or downloads', async context => {
  const partial = cachedFiles(CLIP_DOWNLOAD_URLS.filter(url => !url.endsWith('/text_model_q4f16.onnx')));
  const env = setupRuntime(context, {
    config: { enabled: false, prompted: true, downloadConsent: 'declined' },
    caches: partial
  });
  await clearImageModelDownloads();

  const status = await checkMeaningTextEncodingStatus({ storage: env.storage, cacheStorage: partial });
  assert.equal(status.available, false);
  assert.equal(status.installed, false);
  assert.equal(status.status, 'not-installed');
  assert.match(status.message, /not installed/i);

  const detail = await encodeDefinitionTextsDetailed(['Some definition.'], {
    storage: env.storage,
    cacheStorage: partial
  });
  assert.equal(detail.ok, false);
  assert.equal(detail.status, 'not-installed');
  assert.equal(detail.vectors, null);
  assert.equal(await encodeDefinitionTexts(['Some definition.'], { storage: env.storage, cacheStorage: partial }), null);
  assert.equal(env.workers.length, 0, 'uninstalled text encoder must not spawn any Worker');
  assert.equal(getImageLearningStatus().meaningTextEncoding.status, 'not-installed');
});

test('aborting text encoding while warmup is in flight leaves warmup intact and GPU fallback shares replacement CPU worker', async context => {
  const env = setupRuntime(context, {
    config: { enabled: true, downloadConsent: 'accepted' },
    caches: cachedFiles(),
    autoAnswer: false
  });
  await initializeImageLearning({ storage: env.storage, cacheStorage: cachedFiles(), scheduleWarmup: env.scheduleWarmup });
  const warmup = warmImageLearning({ storage: env.storage });

  // 1. Aborted text request must reject without stopping warmup
  const abortController = new AbortController();
  const abortedCall = encodeDefinitionTexts(['First sense.'], {
    storage: env.storage,
    cacheStorage: cachedFiles(),
    signal: abortController.signal
  });
  abortController.abort(new Error('Caller timed out'));
  await assert.rejects(abortedCall, /Caller timed out/);
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].terminated, false);

  // 2. Non-aborted text request overlapping GPU backendFailure waits through CPU fallback
  const waitingCall = encodeDefinitionTextsDetailed(['Second sense.'], {
    storage: env.storage,
    cacheStorage: cachedFiles()
  });
  const gpuWorker = env.workers[0];
  gpuWorker.answer(gpuWorker.messages[0], { error: 'GPU unavailable', backendFailure: true });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(gpuWorker.terminated, true);
  assert.equal(env.workers.length, 2);

  const cpuWorker = env.workers[1];
  assert.equal(cpuWorker.messages[0].device, 'wasm');
  assert.equal(cpuWorker.messages[0].allowDownloads, false);
  cpuWorker.answer(cpuWorker.messages[0]);
  await warmup;

  const result = await waitingCall;
  assert.equal(result.ok, true);
  assert.equal(result.vectors.length, 1);
  assert.equal(env.workers.length, 2);
  assert.deepEqual(cpuWorker.messages.map(m => m.type), ['initialize', 'texts']);
  assert.equal(cpuWorker.messages[1].allowDownloads, false);
});

test('unsupported environments without Worker report explicit unsupported status', async context => {
  const env = setupRuntime(context, { config: { enabled: false }, caches: cachedFiles() });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  delete globalThis.Worker;
  try {
    const status = await checkMeaningTextEncodingStatus({ storage: env.storage, cacheStorage: cachedFiles() });
    assert.equal(status.available, false);
    assert.equal(status.status, 'unsupported');
    const detail = await encodeDefinitionTextsDetailed(['Sense text.'], { storage: env.storage, cacheStorage: cachedFiles() });
    assert.equal(detail.ok, false);
    assert.equal(detail.status, 'unsupported');
    assert.equal(detail.vectors, null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
  }
});
