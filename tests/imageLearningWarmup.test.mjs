import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, driveSync } from '../js/services/driveSync.js?v=18900';
import { initializeImageLearning, warmImageLearning, enableImageLearning, disableImageLearning,
  getImageLearningStatus, rankImagesLocally } from '../js/services/imageLearning.js?v=18900';
import { CLIP_CACHE, CLIP_DOWNLOAD_URLS, CLIP_TAG } from '../js/ml/clipConfig.js';

const CONFIG_KEY = 'keepvocab_image_learning_device_v1';
const vector = axis => Array.from({ length: 512 }, (_, index) => Number(index === axis));
const meaning = { id: 'run', word: 'run', definition: 'Move quickly on foot.', partOfSpeech: 'verb' };
const photo = { url: 'https://images.example/running-fox.jpg', title: 'A fox running' };

function cachedFiles(urls = CLIP_DOWNLOAD_URLS) {
  const entries = new Set(urls);
  return {
    keys: async () => entries.size ? [CLIP_CACHE] : [],
    open: async () => ({ match: async url => entries.has(url)
      ? new Response('cached', { headers: { 'content-length': '6' } }) : undefined })
  };
}

// No real model, image download, clock delay, or startup idle callback is needed.
function setup(context, { config = {}, autoInitialize = true } = {}) {
  const originals = Object.fromEntries(['localStorage', 'Worker', 'setTimeout', 'clearTimeout']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  disableImageLearning();
  storage.setItem(CONFIG_KEY, JSON.stringify(config));

  const timers = new Map(), delays = [], workers = [], scheduled = [];
  let now = 0, nextTimer = 0;
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    delays.push(delay);
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.Worker = class {
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; this.terminated = false; workers.push(this); }
    postMessage(data) {
      this.messages.push(data);
      if (data.type === 'cancel' || (data.type === 'initialize' && !autoInitialize)) return;
      queueMicrotask(() => this.answer(data));
    }
    answer(data = this.messages.at(-1), response = {}) {
      const result = data.type === 'initialize' ? { backend: data.device === 'auto' ? 'webgpu' : 'wasm' }
        : data.type === 'texts' ? data.payload.texts.map((_, index) => vector(index ? 1 : 0)) : vector(0);
      this.onmessage?.({ data: { id: data.id, result, ...response } });
    }
    status(detail) { this.onmessage?.({ data: { type: 'status', ...detail } }); }
    terminate() { this.terminated = true; }
  };
  const scheduleWarmup = callback => {
    const job = { callback, cancelled: false };
    scheduled.push(job);
    return () => { job.cancelled = true; };
  };
  context.after(() => {
    disableImageLearning();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    storage, workers, scheduled, timers, delays, scheduleWarmup,
    initialize: options => initializeImageLearning({ storage, cacheStorage: cachedFiles(), scheduleWarmup, ...options }),
    tick(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  };
}

test('cached startup returns before model initialization, schedules once, and forbids downloads despite prior consent', async context => {
  const env = setup(context, { config: { enabled: true, downloadConsent: 'accepted' } });
  const first = await env.initialize();
  const second = await env.initialize();
  assert.equal(first.enabled, true);
  assert.equal(second.installed, true);
  assert.equal(env.workers.length, 0, 'startup has not created or initialized a model worker');
  assert.equal(env.scheduled.length, 1, 'repeated initialization shares the scheduled warmup');
  assert.equal(getImageLearningStatus().phase, 'idle');

  env.scheduled[0].callback();
  await warmImageLearning({ storage: env.storage });
  assert.equal(env.workers.length, 1);
  assert.deepEqual(env.workers[0].messages.map(message => message.type), ['initialize']);
  assert.equal(env.workers[0].messages[0].allowDownloads, false);
  assert.equal(getImageLearningStatus().phase, 'ready');
});

test('simultaneous manual warmups share their promise and worker initialization', async context => {
  const env = setup(context, { config: { enabled: true }, autoInitialize: false });
  await env.initialize();
  const first = warmImageLearning({ storage: env.storage });
  const second = warmImageLearning({ storage: env.storage });
  assert.equal(first, second);
  assert.equal(env.scheduled[0].cancelled, true);
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].messages.length, 1);
  env.workers[0].answer();
  await first;
  await warmImageLearning({ storage: env.storage });
  assert.equal(env.workers[0].messages.length, 1, 'ready model is not initialized again by another warmup');
});

test('the warmed worker scores later images and stays loaded beyond the former two-minute idle limit', async context => {
  const env = setup(context, { config: { enabled: true } });
  await env.initialize();
  env.scheduled[0].callback();
  await warmImageLearning({ storage: env.storage });
  assert.equal(env.timers.size, 0, 'completed warmup leaves no idle or RPC timers');
  env.tick(125_000);
  assert.equal(env.workers[0].terminated, false);

  const images = await rankImagesLocally(meaning, [photo], {
    storage: env.storage,
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }),
    resize: () => assert.fail('Small source images need no resize')
  });
  assert.equal(images[0].ml.model, CLIP_TAG);
  assert.ok(Number.isFinite(images[0].ml.score));
  assert.deepEqual(env.workers[0].messages.map(message => message.type), ['initialize', 'texts', 'image']);
  assert.equal(env.workers.length, 1, 'picker reuses the loaded worker');
  assert.equal(env.timers.size, 0, 'completed scoring does not arm a worker teardown timer');
  assert.ok(!env.delays.includes(120_000));
  env.tick(125_000);
  await enableImageLearning({ storage: env.storage, download: false });
  assert.equal(env.workers.length, 1, 'Settings enable also uses the existing worker');
  assert.equal(env.workers[0].terminated, false);
});

test('explicit off, absent cache without permission, and download refusal never schedule a startup warmup', async context => {
  const env = setup(context, { config: { enabled: false } });
  assert.equal((await env.initialize()).enabled, false);
  assert.equal(env.scheduled.length, 0);

  env.storage.setItem(CONFIG_KEY, JSON.stringify({ enabled: true, downloadConsent: 'not-requested' }));
  await env.initialize({ cacheStorage: cachedFiles([]) });
  assert.equal(env.scheduled.length, 0, 'missing files without consent are not downloaded for warmup');

  env.storage.setItem(CONFIG_KEY, '{}');
  let prompts = 0;
  await env.initialize({ cacheStorage: cachedFiles([]), requestDownload: async () => { prompts++; return false; } });
  assert.equal(prompts, 1);
  assert.equal(env.scheduled.length, 0);
  assert.equal(env.workers.length, 0);
});

test('disable cancels an idle warmup and even a late cancelled callback cannot start a worker', async context => {
  const env = setup(context, { config: { enabled: true } });
  await env.initialize();
  disableImageLearning();
  assert.equal(env.scheduled[0].cancelled, true);
  env.scheduled[0].callback();
  assert.equal(env.workers.length, 0);
  assert.equal(getImageLearningStatus().phase, 'off');
});

test('disable during initialization rejects pending warmup and ignores late status from its terminated worker', async context => {
  const env = setup(context, { config: { enabled: true }, autoInitialize: false });
  await env.initialize();
  const warmup = warmImageLearning({ storage: env.storage });
  const candidates = [photo];
  const ranking = rankImagesLocally(meaning, candidates, { storage: env.storage });
  const rejection = assert.rejects(warmup, /stopped/);
  const oldWorker = env.workers[0];
  disableImageLearning();
  await rejection;
  assert.deepEqual(await ranking, [], 'cancelled screening never returns unverified photos');
  assert.equal(oldWorker.terminated, true);
  oldWorker.status({ phase: 'ready', backend: 'webgpu', message: 'Late model ready' });
  oldWorker.answer();
  assert.equal(getImageLearningStatus().phase, 'off');
  assert.equal(getImageLearningStatus().enabled, false);
  assert.equal(env.timers.size, 0);
});

test('a foreground picker before idle cancels scheduled warmup and owns the single shared worker', async context => {
  const env = setup(context, { config: { enabled: true } });
  await env.initialize();
  const images = await rankImagesLocally(meaning, [photo], {
    storage: env.storage,
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }),
    resize: () => assert.fail('Small source images need no resize')
  });
  assert.equal(env.scheduled[0].cancelled, true);
  env.scheduled[0].callback();
  await warmImageLearning({ storage: env.storage });
  assert.equal(env.workers.length, 1);
  assert.deepEqual(env.workers[0].messages.map(message => message.type), ['texts', 'image']);
  assert.equal(images[0].ml.model, CLIP_TAG);
});

test('disable during a picker RPC preserves off when the stopped request rejects', async context => {
  const env = setup(context, { config: { enabled: true } });
  const candidates = [photo];
  const ranking = rankImagesLocally(meaning, candidates, { storage: env.storage });
  disableImageLearning();
  assert.deepEqual(await ranking, [], 'cancelled screening never returns unverified photos');
  assert.equal(getImageLearningStatus().phase, 'off');
  assert.equal(getImageLearningStatus().enabled, false);
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].terminated, true);
});

test('disable while a thumbnail is decoding cannot recreate a model worker after off', async context => {
  const env = setup(context, { config: { enabled: true } });
  let releaseDecode, started;
  const decoding = new Promise(resolve => { started = resolve; });
  const candidates = [photo];
  const ranking = rankImagesLocally(meaning, candidates, {
    storage: env.storage,
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: () => { started(); return new Promise(resolve => { releaseDecode = () => resolve({ width: 64, height: 64 }); }); },
    resize: () => assert.fail('Small source images need no resize')
  });
  await decoding;
  disableImageLearning();
  releaseDecode();
  assert.deepEqual(await ranking, [], 'cancelled screening never returns unverified photos');
  assert.equal(env.workers.length, 1, 'the old picker cannot create a replacement worker');
  assert.deepEqual(env.workers[0].messages.map(message => message.type), ['texts']);
  assert.equal(env.workers[0].terminated, true);
  assert.equal(getImageLearningStatus().phase, 'off');
});

test('disable while personal weights are loading cannot publish stale picker results or ready status', async context => {
  const env = setup(context, { config: { enabled: true } });
  const originalModel = driveSync.imageHistory.model;
  let releaseModel, started;
  const loading = new Promise(resolve => { started = resolve; });
  driveSync.imageHistory.model = () => { started(); return new Promise(resolve => { releaseModel = resolve; }); };
  try {
    const candidates = [photo];
    const ranking = rankImagesLocally(meaning, candidates, {
      storage: env.storage,
      fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
      decode: async () => ({ width: 64, height: 64 }),
      resize: () => assert.fail('Small source images need no resize')
    });
    await loading;
    disableImageLearning();
    releaseModel(null);
    assert.deepEqual(await ranking, [], 'cancelled screening never returns unverified photos');
    assert.equal(getImageLearningStatus().phase, 'off');
  } finally { driveSync.imageHistory.model = originalModel; }
});

test('a stopped warmup cannot overwrite readiness from its replacement worker after delayed model lookup', async context => {
  const env = setup(context, { config: { enabled: true }, autoInitialize: false });
  const originalModel = driveSync.imageHistory.model;
  let releaseOldModel, started, calls = 0;
  const oldModelLoading = new Promise(resolve => { started = resolve; });
  driveSync.imageHistory.model = () => ++calls === 1
    ? new Promise(resolve => { releaseOldModel = resolve; started(); }) : Promise.resolve(null);
  try {
    const oldWarmup = warmImageLearning({ storage: env.storage });
    env.workers[0].answer(undefined, { result: { backend: 'old-backend' } });
    await oldModelLoading;
    env.workers[0].onerror();
    const replacementWarmup = warmImageLearning({ storage: env.storage });
    env.workers[1].answer(undefined, { result: { backend: 'new-backend' } });
    await replacementWarmup;
    assert.equal(getImageLearningStatus().backend, 'new-backend');
    releaseOldModel(null);
    await oldWarmup;
    assert.equal(getImageLearningStatus().phase, 'ready');
    assert.equal(getImageLearningStatus().backend, 'new-backend');
  } finally { driveSync.imageHistory.model = originalModel; }
});

test('awaiting warmup while a foreground worker is still starting waits for readiness', async context => {
  const env = setup(context, { config: { enabled: true }, autoInitialize: false });
  const ranking = rankImagesLocally(meaning, [photo], {
    storage: env.storage,
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }),
    resize: () => assert.fail('Small source images need no resize')
  });
  let settled = false;
  const warmup = warmImageLearning({ storage: env.storage }).then(result => { settled = true; return result; });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(settled, false, 'an existing worker alone is not proof its models are ready');
  const initialization = env.workers[0].messages.find(message => message.type === 'initialize');
  assert.ok(initialization);
  env.workers[0].answer(initialization);
  assert.equal((await warmup).phase, 'ready');
  await ranking;
  assert.equal(env.workers.length, 1);
});

test('a picker cancelled while waiting for startup warmup never sends scoring requests', async context => {
  const env = setup(context, { config: { enabled: true }, autoInitialize: false });
  const warmup = warmImageLearning({ storage: env.storage });
  const controller = new AbortController();
  const candidates = [photo];
  const ranking = rankImagesLocally(meaning, candidates, {
    storage: env.storage, signal: controller.signal,
    fetchImpl: () => assert.fail('Cancelled picker must not download images')
  });
  controller.abort();
  env.workers[0].answer();
  await warmup;
  assert.deepEqual(await ranking, [], 'cancelled screening never returns unverified photos');
  assert.deepEqual(env.workers[0].messages.map(message => message.type), ['initialize']);
  assert.equal(env.workers[0].terminated, false, 'cancelling a picker retains the completed startup warmup');
  assert.equal(getImageLearningStatus().phase, 'ready');
});

test('the foreground picker screens thirty photos and never appends unscored pool entries', async context => {
  const env = setup(context, { config: { enabled: true } });
  const candidates = Array.from({length:35},(_,i)=>({...photo,url:`https://images.example/pool-${i}.jpg`}));
  const images = await rankImagesLocally(meaning, candidates, {
    storage: env.storage,
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width:64, height:64 }),
    resize: () => assert.fail('Small photos need no resize')
  });
  assert.equal(env.workers[0].messages.filter(message=>message.type==='image').length,30);
  assert.ok(images.length>0);
  assert.ok(images.every(image=>image.ml?.model===CLIP_TAG));
  assert.ok(images.every(image=>Number(/pool-(\d+)/.exec(image.url)[1])<30));
});

// Keep last: CPU fallback is intentionally remembered for this service session.
test('a picker overlapping GPU warmup waits through CPU fallback and uses the ready CPU worker', async context => {
  const env = setup(context, { config: { enabled: true, downloadConsent: 'accepted' }, autoInitialize: false });
  await env.initialize();
  const warmup = warmImageLearning({ storage: env.storage });
  const ranking = rankImagesLocally(meaning, [photo], {
    storage: env.storage,
    fetchImpl: async () => new Response('image pixels', { headers: { 'content-type': 'image/jpeg' } }),
    decode: async () => ({ width: 64, height: 64 }),
    resize: () => assert.fail('Small source images need no resize')
  });
  const gpu = env.workers[0];
  assert.equal(gpu.messages[0].device, 'auto');
  assert.deepEqual(gpu.messages.map(message => message.type), ['initialize'], 'picker waits instead of joining a worker that may be replaced');
  gpu.answer(gpu.messages[0], { error: 'GPU unavailable', backendFailure: true });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(gpu.terminated, true);
  assert.equal(env.workers.length, 2);
  const cpu = env.workers[1];
  assert.equal(cpu.messages[0].device, 'wasm');
  assert.equal(cpu.messages[0].allowDownloads, false);
  cpu.answer();
  await warmup;
  const images = await ranking;
  assert.equal(images[0].ml.model, CLIP_TAG);
  assert.ok(Number.isFinite(images[0].ml.score));
  assert.deepEqual(cpu.messages.map(message => message.type), ['initialize', 'texts', 'image']);
  assert.ok(cpu.messages.every(message => message.device === 'wasm'));
  assert.equal(env.workers.length, 2, 'both warmup and picker share the same replacement CPU worker');
  assert.equal(cpu.terminated, false);
  assert.equal(getImageLearningStatus().phase, 'ready');
  assert.equal(getImageLearningStatus().backend, 'wasm');
});

test('an enabled approved upgrade prepares a missing tower only after scheduled idle and reuses its worker', async context => {
  const env = setup(context, { config: { enabled: true, downloadConsent: 'accepted' } });
  const result = await env.initialize({ cacheStorage: cachedFiles(CLIP_DOWNLOAD_URLS.filter(url => !url.endsWith('/text_model_fp16.onnx'))) });
  assert.equal(result.installed, false);
  assert.equal(result.prompted, false);
  assert.equal(env.workers.length, 0, 'opening the app does not wait for a worker');
  assert.equal(env.scheduled.length, 1);
  env.scheduled[0].callback();
  await warmImageLearning({ storage: env.storage });
  assert.equal(env.workers.length, 1);
  assert.equal(env.workers[0].messages[0].allowDownloads, true, 'prior approval covers the missing upgrade file');
  assert.equal(getImageLearningStatus().phase, 'ready');
  await warmImageLearning({ storage: env.storage });
  assert.equal(env.workers.length, 1);
});

test('background upgrade respects offline, data-saver, cellular and a network change before idle', async context => {
  const env = setup(context, { config: { enabled: true, downloadConsent: 'accepted' } });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  context.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
  for (const navigator of [{ onLine: false }, { connection: { saveData: true } }, { connection: { type: 'cellular' } }]) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
    await env.initialize({ cacheStorage: cachedFiles([]) });
    assert.equal(env.scheduled.length, 0);
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  await env.initialize({ cacheStorage: cachedFiles([]) });
  assert.equal(env.scheduled.length, 1);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { connection: { saveData: true } } });
  env.scheduled[0].callback();
  assert.equal(env.workers.length, 0);
});
