import { AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import { CLIP_MODEL, CLIP_REVISION, CLIP_TAG, CLIP_CACHE, VECTOR_DB, ORT_VERSION } from '../js/ml/clipConfig.js';
import { normalizedVector } from '../js/services/imagePreferences.js';

env.allowLocalModels = false;
// Some optional tokenizer/config lookups omit revision. Pin their URLs and cache
// keys too, so a cold worker can load the same files without a network connection.
env.remotePathTemplate = `{model}/resolve/${CLIP_REVISION}/`;
env.useBrowserCache = true;
env.useFSCache = false;
env.cacheKey = CLIP_CACHE;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
const runtime = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
env.backends.onnx.wasm.wasmPaths = { mjs: runtime + 'ort-wasm-simd-threaded.asyncify.mjs', wasm: runtime + 'ort-wasm-simd-threaded.asyncify.wasm' };
let models = null;
let allowDownloads = true;
const originalFetch = env.fetch;
env.fetch = (input, options) => {
  if (!allowDownloads) throw new Error('Connect to Wi-Fi or explicitly download the model in Settings before using mobile data.');
  return originalFetch(input, options);
};
let backend = 'wasm';
let database;
const memory = new Map();
const cancelled = new Set();
const status = detail => self.postMessage({ type: 'status', ...detail });
async function db() {
  if (!self.indexedDB) return null;
  if (!database) database = new Promise(resolve => {
    const request = indexedDB.open(VECTOR_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vectors', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return database;
}
async function cached(key, compute) {
  if (memory.has(key)) return memory.get(key);
  const database = await db();
  let record;
  if (database) record = await new Promise(resolve => {
    const request = database.transaction('vectors').objectStore('vectors').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null);
  });
  let vector;
  try { vector = record ? normalizedVector(Array.from(record.vector)) : null; } catch { vector = null; }
  if (!vector) vector = normalizedVector(await compute());
  memory.set(key, vector);
  while (memory.size > 80) memory.delete(memory.keys().next().value);
  if (database) {
    try {
      const store = database.transaction('vectors', 'readwrite').objectStore('vectors');
      store.put({ key, vector: Float32Array.from(vector), accessedAt: Date.now() });
      const request = store.getAll();
      request.onsuccess = () => request.result.sort((a, b) => b.accessedAt - a.accessedAt).slice(600).forEach(item => store.delete(item.key));
    } catch { /* Inference remains available when storage is full. */ }
  }
  return vector;
}
async function initialize(devicePreference = 'auto') {
  if (models) return models;
  models = (async () => {
    status({ phase: 'loading', message: 'Loading local image and text models…' });
    const progress_callback = data => status({ phase: 'loading', file: data.file, progress: data.progress, loaded: data.loaded, total: data.total });
    const config = { revision: CLIP_REVISION, dtype: 'q8', progress_callback };
    const tokenizer = await AutoTokenizer.from_pretrained(CLIP_MODEL, config);
    const processor = await AutoProcessor.from_pretrained(CLIP_MODEL, config);
    let textModel, visionModel;
    // Quantized WASM is the predictable baseline; WebGPU is attempted only on a supported adapter.
    const gpu = self.navigator?.gpu && await navigator.gpu.requestAdapter().catch(() => null);
    const devices = devicePreference === 'wasm' || !gpu ? ['wasm'] : ['webgpu'];
    gpu?.destroy?.();
    for (const device of devices) {
      try {
        backend = device;
        textModel = await CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { ...config, device });
        visionModel = await CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { ...config, device });
        backend = device; break;
      } catch (error) {
        await textModel?.dispose().catch(() => {}); await visionModel?.dispose().catch(() => {});
        textModel = null; visionModel = null;
        throw error;
      }
    }
    status({ phase: 'ready', backend, message: 'Local image model is ready.' });
    return { tokenizer, processor, textModel, visionModel };
  })().catch(error => { models = null; throw error; });
  return models;
}
async function run({ type, payload, device }) {
  const model = await initialize(device);
  if (type === 'initialize') return { backend, model: CLIP_TAG };
  if (type === 'texts') {
    const texts = payload.texts;
    if (!Array.isArray(texts) || texts.length > 20 || texts.some(text => typeof text !== 'string' || text.length > 2000)) throw new Error('Invalid text embedding request.');
    const result = [];
    for (const text of texts) result.push(await cached(`${CLIP_TAG}:text:${text}`, async () => {
      const inputs = model.tokenizer([text], { padding: 'max_length', truncation: true });
      const output = await model.textModel(inputs);
      const vector = Array.from(output.text_embeds.data);
      for (const tensor of Object.values(output)) tensor?.dispose?.();
      return vector;
    }));
    return result;
  }
  if (type === 'image') {
    const blob = payload.blob;
    if (!(blob instanceof Blob) || blob.size > 128_000 || !/^image\/(png|jpeg|webp)$/.test(blob.type)) throw new Error('Invalid thumbnail.');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');
    return cached(`${CLIP_TAG}:image:${digest}`, async () => {
      const image = await RawImage.fromBlob(blob);
      if (image.width > 384 || image.height > 384) throw new Error('Thumbnail is too large.');
      const inputs = await model.processor(image);
      const output = await model.visionModel(inputs);
      const vector = Array.from(output.image_embeds.data);
      for (const tensor of [...Object.values(inputs), ...Object.values(output)]) tensor?.dispose?.();
      return vector;
    });
  }
  throw new Error('Unsupported model request.');
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { cancelled.add(data.id); return; }
  queue = queue.then(async () => {
    if (cancelled.delete(data.id)) return;
    try { allowDownloads = data.allowDownloads !== false; const result = await run(data); if (!cancelled.delete(data.id)) self.postMessage({ id: data.id, result }); }
    catch (error) { if (!cancelled.delete(data.id)) self.postMessage({ id: data.id, error: error.message || 'Local image inference failed.', backendFailure: backend === 'webgpu' }); }
  }).catch(() => {});
};
