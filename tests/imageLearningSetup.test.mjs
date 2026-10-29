import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { MemoryStorage } from '../js/services/driveSync.js?v=18900';
import { initializeImageLearning, hasDownloadedImageModel, imageLearningEnabled, enableImageLearning, disableImageLearning } from '../js/services/imageLearning.js?v=18900';
import { CLIP_CACHE, CLIP_DOWNLOAD_URLS, CLIP_RUNTIME_URLS, CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE } from '../js/ml/clipConfig.js';

const CONFIG_KEY = 'keepvocab_image_learning_device_v1';
function cacheStorage(urls = []) {
  const entries = new Map(urls.map(url => [url, new Response('cached', { headers: { 'content-length': '6' } })]));
  return {
    keys: async () => entries.size ? [CLIP_CACHE] : [],
    open: async () => ({ match: async url => entries.get(url)?.clone(), put: async (url, response) => entries.set(url, response) })
  };
}

test('first launch asks once, refusal persists, and no download starts', async () => {
  const storage = new MemoryStorage();
  let prompts = 0, installs = 0;
  const options = { storage, cacheStorage: cacheStorage(), requestDownload: async () => { prompts++; return false; }, enable: async () => { installs++; } };
  assert.equal((await initializeImageLearning(options)).prompted, true);
  assert.equal((await initializeImageLearning(options)).prompted, false);
  assert.equal(prompts, 1);
  assert.equal(installs, 0);
  assert.equal(imageLearningEnabled(storage), false);
  assert.equal(JSON.parse(storage.getItem(CONFIG_KEY)).downloadConsent, 'declined');
});

test('consent is stored before download; a failed install does not repeat the prompt', async () => {
  const storage = new MemoryStorage();
  let prompts = 0;
  await assert.rejects(initializeImageLearning({ storage, cacheStorage: cacheStorage(), requestDownload: async () => { prompts++; return true; }, enable: async options => {
    assert.equal(options.allowMetered, true);
    assert.equal(JSON.parse(storage.getItem(CONFIG_KEY)).downloadConsent, 'accepted');
    throw new Error('offline');
  } }), /offline/);
  await initializeImageLearning({ storage, cacheStorage: cacheStorage(), requestDownload: async () => { prompts++; return false; } });
  assert.equal(prompts, 1);
  assert.equal(imageLearningEnabled(storage), true);
});

test('a complete pinned installation enables by default without asking or downloading', async () => {
  const storage = new MemoryStorage();
  const result = await initializeImageLearning({ storage, cacheStorage: cacheStorage(CLIP_DOWNLOAD_URLS), requestDownload: () => { throw new Error('must not prompt'); }, enable: () => { throw new Error('must not download'); } });
  assert.equal(result.installed, true);
  assert.equal(result.enabled, true);
  assert.equal(JSON.parse(storage.getItem(CONFIG_KEY)).downloadConsent, 'not-requested');
});

test('partial downloads, missing runtime, empty responses and old revisions are not a complete installation', async () => {
  assert.equal(await hasDownloadedImageModel(cacheStorage(CLIP_DOWNLOAD_URLS.slice(0, -1))), false);
  assert.equal(await hasDownloadedImageModel(cacheStorage(CLIP_DOWNLOAD_URLS.map(url => url.replace(/757d59c9c6870a76a4b0306f05f5061bca15c39f/g, 'old')))), false);
  const empty = cacheStorage(CLIP_DOWNLOAD_URLS);
  await (await empty.open(CLIP_CACHE)).put(CLIP_DOWNLOAD_URLS[0], new Response('', { headers: { 'content-length': '0' } }));
  assert.equal(await hasDownloadedImageModel(empty), false);
  assert.equal(await hasDownloadedImageModel(cacheStorage(CLIP_DOWNLOAD_URLS)), true);
});

test('an explicit off preference survives a cached installation and an existing opt-in keeps permission', async () => {
  const storage = new MemoryStorage();
  storage.setItem(CONFIG_KEY, JSON.stringify({ enabled: false }));
  assert.equal((await initializeImageLearning({ storage, cacheStorage: cacheStorage(CLIP_DOWNLOAD_URLS) })).enabled, false);
  storage.setItem(CONFIG_KEY, JSON.stringify({ enabled: true }));
  await initializeImageLearning({ storage, cacheStorage: cacheStorage() });
  assert.equal(JSON.parse(storage.getItem(CONFIG_KEY)).downloadConsent, 'accepted');
});

test('Settings can install after refusal and worker requests carry the saved permission', async t => {
  const original = { storage: globalThis.localStorage, Worker: globalThis.Worker };
  const sent = [];
  globalThis.localStorage = new MemoryStorage();
  globalThis.Worker = class {
    postMessage(data) { sent.push(data); queueMicrotask(() => this.onmessage({ data: { id: data.id, result: { backend: 'wasm' } } })); }
    terminate() {}
  };
  t.after(() => { disableImageLearning(); if (original.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = original.storage; if (original.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = original.Worker; });
  await initializeImageLearning({ cacheStorage: cacheStorage(), requestDownload: async () => false });
  await enableImageLearning({ allowMetered: true });
  assert.equal(sent[0].allowDownloads, true);
  assert.equal(imageLearningEnabled(), true);
});

test('turning on an installed model without download consent keeps network access blocked', async t => {
  const original = { storage: globalThis.localStorage, Worker: globalThis.Worker };
  const sent = [];
  globalThis.localStorage = new MemoryStorage();
  globalThis.Worker = class {
    postMessage(data) { sent.push(data); queueMicrotask(() => this.onmessage({ data: { id: data.id, result: { backend: 'wasm' } } })); }
    terminate() {}
  };
  t.after(() => { disableImageLearning(); if (original.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = original.storage; if (original.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = original.Worker; });
  await initializeImageLearning({ cacheStorage: cacheStorage(CLIP_DOWNLOAD_URLS) });
  disableImageLearning();
  await enableImageLearning({ allowMetered: true, download: false });
  assert.equal(sent[0].allowDownloads, false);
});

test('the worker loads a cached runtime offline and rejects missing files without consent', async () => {
  const source = readFileSync(new URL('../scripts/clip-worker.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  const calls = [], messages = [];
  const makeContext = urls => {
    const env = { fetch: async url => { calls.push(url); return new Response('runtime'); }, backends: { onnx: { wasm: {} } } };
    const factory = { from_pretrained: async (_, options) => { assert.equal(options.local_files_only, false); return {}; } };
    const tower = expected => ({ from_pretrained: async (_, options) => { assert.equal(options.dtype, expected); assert.equal(options.local_files_only, false); return {}; } });
    const self = { caches: cacheStorage(urls), postMessage: message => messages.push(message), navigator: {} };
    const context = vm.createContext({ env, self, CLIP_MODEL: 'model', CLIP_REVISION: 'revision', CLIP_TAG: 'tag', CLIP_CACHE, VECTOR_DB: 'vectors', CLIP_RUNTIME_URLS, AutoTokenizer: factory, AutoProcessor: factory, CLIPTextModelWithProjection: tower('fp16'), CLIPVisionModelWithProjection: tower('fp32'), CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE, URL: { createObjectURL: () => 'blob:cached' }, Blob, Map, Set, Promise });
    vm.runInContext(source, context);
    return { context, self, env };
  };
  const cached = makeContext(CLIP_RUNTIME_URLS);
  cached.self.onmessage({ data: { id: 1, type: 'initialize', payload: {}, allowDownloads: false } });
  await vm.runInContext('queue', cached.context);
  assert.equal(messages.at(-1).result.backend, 'wasm');
  assert.equal(cached.env.backends.onnx.wasm.wasmPaths.wasm, 'blob:cached');
  assert.equal(calls.length, 0);
  assert.throws(() => cached.env.fetch('https://example.test/missing-model.onnx'), /missing|Download/);
  const missing = makeContext([]);
  missing.self.onmessage({ data: { id: 2, type: 'initialize', payload: {}, allowDownloads: false } });
  await vm.runInContext('queue', missing.context);
  assert.match(messages.at(-1).error, /runtime is missing/);
  assert.equal(calls.length, 0);
});
