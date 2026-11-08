import { AutoTokenizer, AutoProcessor, SiglipTextModel, SiglipVisionModel, RawImage, env } from '@huggingface/transformers';
import { CLIP_MODEL, CLIP_MODEL_BASE, CLIP_REVISION, CLIP_TAG, CLIP_CACHE, VECTOR_DB, CLIP_RUNTIME_URLS, CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE, CLIP_DIMENSION } from '../js/ml/clipConfig.js';
import { fetchCompactModelFile } from '../js/services/compactModelDownload.js';
import { normalizedVector } from '../js/services/imagePreferences.js';
import { fullFrameImage, centerCropImage } from '../js/services/imagePreprocessing.js';
import { IMAGE_PREPROCESSING } from '../js/services/imagePersonalizer.js';

env.allowLocalModels = false;
// Some optional tokenizer/config lookups omit revision. Pin their URLs and cache
// keys too, so a cold worker can load the same files without a network connection.
const modelSource = CLIP_MODEL_BASE.replace(/\/$/, '');
const sourceSplit = modelSource.lastIndexOf('/');
env.remoteHost = modelSource.slice(0, sourceSplit);
env.remotePathTemplate = modelSource.slice(sourceSplit + 1);
env.useBrowserCache = true;
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
  if (!allowDownloads) throw new Error('Model files are missing. Download the local image model in Settings to continue.');
  return fetchCompactModelFile(input, options, originalFetch);
};
let backend = 'wasm';
let runtimeReady;
async function prepareRuntime() {
  if (!runtimeReady) runtimeReady = (async () => {
    const cache = await self.caches?.open(CLIP_CACHE);
    const blobs = await Promise.all(CLIP_RUNTIME_URLS.map(async url => {
      let response = await cache?.match(url);
      if (!response) {
        if (!allowDownloads) throw new Error('The local runtime is missing. Download the image model in Settings.');
        response = await fetchCompactModelFile(url, undefined, originalFetch);
        if (!response.ok) throw new Error('The local image runtime could not be downloaded.');
        await cache?.put(url, response.clone());
      }
      return URL.createObjectURL(await response.blob());
    }));
    // Both files are cached under the same consent as the model. Object URLs
    // prevent ONNX Runtime from silently fetching its runtime from a CDN.
    env.backends.onnx.wasm.wasmPaths = { mjs: blobs[0], wasm: blobs[1] };
  })().catch(error => { runtimeReady = null; throw error; });
  return runtimeReady;
}
let database;
let vectorWrites = 0;
// Older WebGPU q4f16 vision outputs disagreed materially with native/WASM.
// Retire those cached vectors while retaining the downloaded model files.
const VECTOR_TAG = `${CLIP_TAG}:validated-wasm-v1`;
const memory = new Map();
const cancelled = new Set();
const status = detail => self.postMessage({ type: 'status', ...detail });
async function db() {
  if (!self.indexedDB) return null;
  if (!database) database = new Promise(resolve => {
    const request = indexedDB.open(VECTOR_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('vectors', { keyPath: 'key' });
    request.onsuccess = () => {
      const conn = request.result;
      try {
        const store = conn.transaction('vectors', 'readwrite').objectStore('vectors');
        const all = store.getAll();
        all.onsuccess = () => all.result.forEach(item => {
          if (typeof item?.key === 'string' && !item.key.startsWith(`${VECTOR_TAG}:`)) store.delete(item.key);
        });
      } catch { /* Pruning retired encoder vectors is best-effort. */ }
      resolve(conn);
    };
    request.onerror = () => resolve(null);
  });
  return database;
}
async function readVector(key) {
  if (memory.has(key)) return memory.get(key);
  const database = await db();
  let record;
  if (database) record = await new Promise(resolve => {
    const request = database.transaction('vectors').objectStore('vectors').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(null);
  });
  let vector;
  try { vector = record ? normalizedVector(Array.from(record.vector)) : null; } catch { vector = null; }
  if (vector) memory.set(key, vector);
  return vector;
}
async function storeVector(key, vector) {
  const database = await db();
  memory.set(key, vector);
  while (memory.size > 80) memory.delete(memory.keys().next().value);
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
async function cached(key, compute) {
  return (await cachedMany([key], async () => [await compute()]))[0];
}
function outputRows(tensor, count) {
  const values = tensor.type === 'float16' ? tensor.to('float32').data : tensor.data;
  if (values.length !== count * CLIP_DIMENSION) throw new Error('Invalid embedding dimensions.');
  return Array.from({ length: count }, (_, row) => Array.from(values.slice(row * CLIP_DIMENSION, (row + 1) * CLIP_DIMENSION)));
}
async function initialize(devicePreference = 'auto') {
  if (models) return models;
  models = (async () => {
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
    let textModel, visionModel;
    // CPU agrees with the evaluation encoder. Successful GPU execution alone
    // is insufficient: this graph produced silently incorrect vision vectors.
    const devices = ['wasm'];
    for (const device of devices) {
      try {
        backend = device;
        const towers = await Promise.allSettled([
          visionOnly ? null : SiglipTextModel.from_pretrained(CLIP_MODEL, { ...config, device, dtype: CLIP_TEXT_DTYPE }),
          SiglipVisionModel.from_pretrained(CLIP_MODEL, { ...config, device, dtype: CLIP_VISION_DTYPE })
        ]);
        // A rejected Promise.all loses both assignments, including a tower
        // that finishes later. Keep ownership until both settle so failures
        // release every loaded graph before a retry or CPU fallback.
        textModel = towers[0].status === 'fulfilled' ? towers[0].value : null;
        visionModel = towers[1].status === 'fulfilled' ? towers[1].value : null;
        const failed = towers.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
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
    if (!model.textModel) throw new Error('This worker only scores images.');
    const texts = payload.texts;
    if (!Array.isArray(texts) || texts.length > 20 || texts.some(text => typeof text !== 'string' || text.length > 2000)) throw new Error('Invalid text embedding request.');
    const result = [];
    for (let start = 0; start < texts.length; start += 8) {
      const batch = texts.slice(start, start + 8);
      result.push(...await cachedMany(batch.map(text => `${VECTOR_TAG}:text:${text}`), async missing => {
        const inputs = model.tokenizer(missing.map(index => batch[index].toLowerCase()), { padding: 'max_length', max_length: 64, truncation: true });
        let output;
        try {
          output = await model.textModel({ input_ids: inputs.input_ids });
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
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');
    let decodedImage = null;
    const decodeOnce = async () => {
      if (!decodedImage) {
        decodedImage = await RawImage.fromBlob(blob);
        if (decodedImage.width > 384 || decodedImage.height > 384) throw new Error('Thumbnail is too large.');
      }
      return decodedImage;
    };
    const keys = [`${VECTOR_TAG}:${IMAGE_PREPROCESSING}:image:${digest}`];
    if (payload.multiView) keys.push(`${VECTOR_TAG}:${IMAGE_PREPROCESSING}:crop68:${digest}`);
    const [fullVector, cropVector] = await cachedMany(keys, async missing => {
      const image = await decodeOnce();
      const frames = await Promise.all(missing.map(index => index === 0
        ? fullFrameImage(image, RawImage) : centerCropImage(image, RawImage, 256, 0.68)));
      const inputs = await model.processor(frames);
      let output;
      try {
        output = await model.visionModel({ pixel_values: inputs.pixel_values });
        return outputRows(output.image_embeds || output.pooler_output, frames.length);
      } finally {
        for (const tensor of [...Object.values(inputs), ...Object.values(output || {})]) tensor?.dispose?.();
      }
    });
    if (!payload.multiView) return fullVector;
    const blendVector = normalizedVector(fullVector.map((v, i) => 0.55 * v + 0.45 * cropVector[i]));
    return { vector: blendVector, fullVector, cropVector };
  }
  throw new Error('Unsupported model request.');
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { cancelled.add(data.id); return; }
  queue = queue.then(async () => {
    if (cancelled.delete(data.id)) return;
    try {
      allowDownloads = data.allowDownloads === true;
      if (!models && data.role === 'vision') role = 'vision';
      configureThreads(data.threads);
      const result = await run(data); if (!cancelled.delete(data.id)) self.postMessage({ id: data.id, result }); }
    catch (error) { if (!cancelled.delete(data.id)) self.postMessage({ id: data.id, error: error.message || 'Local image inference failed.', backendFailure: backend === 'webgpu' }); }
  }).catch(() => {});
};
