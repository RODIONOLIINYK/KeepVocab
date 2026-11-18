import { createInferenceTimings } from '../js/services/inferenceTimings.js';
import { AutoTokenizer, AutoProcessor, SiglipTextModel, SiglipVisionModel, RawImage, env } from '@huggingface/transformers';
import { CLIP_MODEL, CLIP_MODEL_BASE, CLIP_REVISION, CLIP_TAG, CLIP_CACHE, VECTOR_DB, CLIP_RUNTIME_URLS, CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE, CLIP_DIMENSION, CLIP_TEXT_MAX_LENGTH, COMPACT_MODEL_ASSETS } from '../js/ml/clipConfig.js';
import { fetchCompactModelFile } from '../js/services/compactModelDownload.js';
import { normalizedVector } from '../js/services/imagePreferences.js';
import { fullFrameImage, centerCropImage } from '../js/services/imagePreprocessing.js';
import { IMAGE_PREPROCESSING } from '../js/services/imagePersonalizer.js';
import { workerModelCache } from '../js/services/modelCache.js';
import { inferenceQueue, sharedInferenceScope } from '../js/services/sharedInferenceScope.js';

const timings = createInferenceTimings('clip');
const channel = typeof self.postMessage === 'function' ? self : sharedInferenceScope(self, 'clip');

env.allowLocalModels = false;
// Some optional tokenizer/config lookups omit revision. Pin their URLs and cache
// keys too, so a cold worker can load the same files without a network connection.
const modelSource = CLIP_MODEL_BASE.replace(/\/$/, '');
const sourceSplit = modelSource.lastIndexOf('/');
env.remoteHost = modelSource.slice(0, sourceSplit);
env.remotePathTemplate = modelSource.slice(sourceSplit + 1);
env.useBrowserCache = false;
env.useCustomCache = true;
const fileTransfers = new Map();
function reportModelDownload(detail) {
  if (!COMPACT_MODEL_ASSETS[detail.file]?.downloadBytes) return;
  fileTransfers.set(detail.file, detail.loaded);
  const total = Object.values(COMPACT_MODEL_ASSETS).reduce((sum, asset) => sum + (asset.downloadBytes || 0), 0);
  const loaded = [...fileTransfers.values()].reduce((sum, bytes) => sum + bytes, 0);
  status({ phase: 'loading', downloadProgress: { loaded, total, stage: detail.stage } });
}
const modelFileCache = workerModelCache(CLIP_CACHE, timings);
env.customCache = { ...modelFileCache, match: async request => {
  const response = await modelFileCache.match(request);
  const url = typeof request === 'string' ? request : request?.url;
  const file = url?.startsWith(CLIP_MODEL_BASE) ? url.slice(CLIP_MODEL_BASE.length) : '';
  if (response && COMPACT_MODEL_ASSETS[file]?.downloadBytes) reportModelDownload({ file, loaded: COMPACT_MODEL_ASSETS[file].downloadBytes, stage: 'loading' });
  return response;
} };
env.useFSCache = false;
env.cacheKey = CLIP_CACHE;
// The page chooses the thread count (see inferencePlan in imageLearning.js).
// Shared-memory threads need cross-origin isolation; otherwise stay at one
// thread and the page parallelises across a pool of workers instead.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
let models = null;
// A 'vision' helper only scores images; it never loads the large text tower.
let role = 'full';
function configureThreads(threads) {
  if (models) return;
  const allowed = self.crossOriginIsolated ? Math.max(1, Math.min(8, Math.floor(Number(threads) || 1))) : 1;
  env.backends.onnx.wasm.numThreads = allowed;
}
let allowDownloads = false;
const originalFetch = env.fetch;
env.fetch = (input, options) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (self.location?.href && ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
    .some(file => url === new URL(`./runtime/${file}`, self.location.href).href)) return originalFetch(input, options);
  if (!allowDownloads) throw new Error('Model files are missing. Download the local image model in Settings to continue.');
  return fetchCompactModelFile(input, options, originalFetch, reportModelDownload);
};
const backend = 'wasm';
let runtimeReady;
async function prepareRuntime() {
  if (!runtimeReady) runtimeReady = (async () => {
    // Both models share one app-owned runtime; never keep a second downloaded
    // runtime in the browser profile or let ORT silently fetch a CDN copy.
    env.backends.onnx.wasm.wasmPaths = {
      mjs: new URL('./runtime/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
      wasm: new URL('./runtime/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href
    };
  })().catch(error => { runtimeReady = null; throw error; });
  return runtimeReady;
}
let database;
let vectorWrites = 0;
// Older WebGPU q4f16 vision outputs disagreed materially with native/WASM.
// Retire those cached vectors while retaining the downloaded model files.
const VECTOR_TAG = `${CLIP_TAG}:validated-wasm-v1`;
const memory = new Map();
const status = detail => channel.postMessage({ type: 'status', ...detail });
async function db() {
  if (!self.indexedDB) return null;
  if (!database) database = new Promise(resolve => {
    const request = indexedDB.open(VECTOR_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vectors', { keyPath: 'key' });
    request.onsuccess = () => {
      const conn = request.result;
      conn.onversionchange = () => { conn.close(); database = null; };
      try {
        const store = conn.transaction('vectors', 'readwrite').objectStore('vectors');
        const cursor = store.openKeyCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const key = item.key;
          // Image vectors now belong to the page's short-lived scoring session.
          if (typeof key === 'string' && (!key.startsWith(`${VECTOR_TAG}:`) || key.includes(':image:') || key.includes(':crop68:'))) store.delete(key);
          item.continue();
        };
      } catch { /* Pruning retired encoder vectors is best-effort. */ }
      resolve(conn);
    };
    request.onerror = () => resolve(null);
  });
  return database.catch(() => null);
}
function rememberVector(key, vector) {
  memory.delete(key);
  memory.set(key, vector);
  if (memory.size > 80) memory.delete(memory.keys().next().value);
  return vector;
}
async function readVector(key) {
  if (memory.has(key)) return rememberVector(key, memory.get(key));
  try {
    const database = await db();
    if (!database) return null;
    const record = await new Promise((resolve, reject) => {
      const request = database.transaction('vectors').objectStore('vectors').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return record ? rememberVector(key, normalizedVector(record.vector)) : null;
  } catch { return null; } // A missing or unreadable optional cache is a miss.
}
async function storeVector(key, vector) {
  const database = await db();
  rememberVector(key, vector);
  if (database) {
    try {
      const store = database.transaction('vectors', 'readwrite').objectStore('vectors');
      store.put({ key, vector: Float32Array.from(vector), accessedAt: Date.now() });
      if ((++vectorWrites & 31) === 0) {
        const request = store.getAll();
        request.onsuccess = () => request.result.sort((a, b) => b.accessedAt - a.accessedAt).slice(600).forEach(item => store.delete(item.key));
      }
    } catch { /* Inference remains available when storage is full. */ }
  }
  return vector;
}
// Batch only cache misses, preserving input order and all previous vectors.
async function cachedMany(keys, compute) {
  const vectors = await Promise.all(keys.map(readVector));
  const misses = new Map();
  vectors.forEach((vector, index) => { if (!vector && !misses.has(keys[index])) misses.set(keys[index], index); });
  const missing = [...misses.values()];
  if (missing.length) {
    const computed = await compute(missing);
    if (computed.length !== missing.length) throw new Error('Invalid embedding batch.');
    for (let row = 0; row < missing.length; row++) {
      const index = missing[row];
      vectors[index] = normalizedVector(computed[row]);
      await storeVector(keys[index], vectors[index]);
    }
    vectors.forEach((vector, index) => { if (!vector) vectors[index] = vectors[misses.get(keys[index])]; });
  }
  return vectors;
}
function outputRows(tensor, count) {
  const converted = tensor.type === 'float16' ? tensor.to('float32') : null;
  try {
    const values = (converted || tensor).data;
    if (values.length !== count * CLIP_DIMENSION) throw new Error('Invalid embedding dimensions.');
    return Array.from({ length: count }, (_, row) => Array.from(values.subarray(row * CLIP_DIMENSION, (row + 1) * CLIP_DIMENSION)));
  } finally { converted?.dispose(); }
}
async function initialize() {
  if (models) return models;
  models = timings.measure('initialize', async () => {
    status({ phase: 'loading', message: 'Loading local image and text models…' });
    await prepareRuntime();
    const progress_callback = data => status({ phase: 'loading', file: data.file, progress: data.progress, loaded: data.loaded, total: data.total });
    // local_files_only=true conflicts with allowLocalModels=false in this
    // runtime, even with a complete browser cache. Cache misses are protected
    // by the explicit consent-enforcing env.fetch wrapper above instead.
    const config = { revision: CLIP_REVISION, progress_callback, local_files_only: false };
    // Both towers use q4f16; the full multilingual token table uses INT4.
    const visionOnly = role === 'vision';
    const [tokenizer, processor] = await Promise.all([
      visionOnly ? null : AutoTokenizer.from_pretrained(CLIP_MODEL, config),
      AutoProcessor.from_pretrained(CLIP_MODEL, config)
    ]);
    const towers = await Promise.allSettled([
      visionOnly ? null : SiglipTextModel.from_pretrained(CLIP_MODEL, { ...config, device: backend, dtype: CLIP_TEXT_DTYPE }),
      SiglipVisionModel.from_pretrained(CLIP_MODEL, { ...config, device: backend, dtype: CLIP_VISION_DTYPE })
    ]);
    const failed = towers.find(result => result.status === 'rejected');
    if (failed) {
      await Promise.allSettled(towers.map(async tower => { if (tower.status === 'fulfilled') await tower.value?.dispose(); }));
      throw failed.reason;
    }
    const [textModel, visionModel] = towers.map(tower => tower.value);
    status({ phase: 'ready', backend, message: 'Local image model is ready.' });
    return { tokenizer, processor, textModel, visionModel };
  }).catch(error => { models = null; throw error; });
  return models;
}
async function run({ type, payload }, current = () => true) {
  const model = await initialize();
  if (!current()) return;
  if (type === 'initialize') return { backend, model: CLIP_TAG };
  if (type === 'texts') {
    if (!model.textModel) throw new Error('This worker only scores images.');
    const texts = payload.texts;
    if (!Array.isArray(texts) || texts.length > 20 || texts.some(text => typeof text !== 'string' || text.length > 2000)) throw new Error('Invalid text embedding request.');
    const result = [];
    for (let start = 0; start < texts.length; start += 8) {
      if (!current()) return;
      const batch = texts.slice(start, start + 8);
      result.push(...await cachedMany(batch.map(text => `${VECTOR_TAG}:text:${text}`), async missing => {
        const inputs = model.tokenizer(missing.map(index => batch[index].toLowerCase()), { padding: 'max_length', max_length: CLIP_TEXT_MAX_LENGTH, truncation: true });
        let output;
        try {
          output = await timings.measure('text-forward', () => model.textModel({ input_ids: inputs.input_ids }), { batch: missing.length });
          return outputRows(output.text_embeds || output.pooler_output, missing.length);
        } finally {
          for (const tensor of [...Object.values(inputs), ...Object.values(output || {})]) tensor?.dispose?.();
        }
      }));
    }
    return result;
  }
  if (type === 'image') {
    const blob = payload.blob;
    if (!(blob instanceof Blob) || blob.size > 128_000 || !/^image\/(png|jpeg|webp)$/.test(blob.type)) throw new Error('Invalid thumbnail.');
    const image = await RawImage.fromBlob(blob);
    if (image.width > 384 || image.height > 384) throw new Error('Thumbnail is too large.');
    if (!current()) return;
    const frames = [fullFrameImage(image, RawImage)];
    if (payload.multiView) frames.push(centerCropImage(image, RawImage, 256, 0.68));
    const inputs = await model.processor(await Promise.all(frames));
    let output, fullVector, cropVector;
    try {
      if (!current()) return;
      output = await timings.measure('image-forward', () => model.visionModel({ pixel_values: inputs.pixel_values }), { batch: frames.length });
      [fullVector, cropVector] = outputRows(output.image_embeds || output.pooler_output, frames.length);
    } finally {
      for (const tensor of [...Object.values(inputs), ...Object.values(output || {})]) tensor?.dispose?.();
    }
    if (!payload.multiView) return fullVector;
    const blendVector = normalizedVector(fullVector.map((v, i) => 0.55 * v + 0.45 * cropVector[i]));
    return { vector: blendVector, fullVector, cropVector };
  }
  throw new Error('Unsupported model request.');
}
channel.onmessage = inferenceQueue(channel, (data, current) => {
  allowDownloads = data.allowDownloads === true;
  if (!models && data.role === 'vision') role = 'vision';
  configureThreads(data.threads);
  return run(data, current);
}, timings);
