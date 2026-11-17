import { MEANING_MODEL_TAG, MEANING_MODEL_BASE, MEANING_CACHE } from '../ml/meaningConfig.js';
import { MEANING_MODEL_ASSETS } from '../ml/meaningAssets.js';
import { meaningEmbeddingText } from './meaningComparison.js';
import { modelCacheStorage, handleModelCacheRequest } from './modelCache.js';
import { readModelDownload } from './modelDownloadProgress.js';

let worker, nextId = 0;
const pending = new Map();
const listeners = new Set();
let installed = false, phase = 'not-installed', message = 'Download the merge model to compare meanings locally.', downloading;
let downloadProgress = null, preloadPromise;
const downloadBytes = () => Object.values(MEANING_MODEL_ASSETS).reduce((sum, file) => sum + file.bytes, 0);
export const getMeaningModelStatus = () => ({ installed, phase, message, ready: phase === 'ready', downloadProgress,
  downloadMB: Math.ceil(Object.values(MEANING_MODEL_ASSETS).reduce((sum, file) => sum + file.bytes, 0) / 1e6) });
function emit() { for (const listener of listeners) listener(getMeaningModelStatus()); }
export function subscribeMeaningModel(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export async function checkMeaningModelInstalled() {
  const cache = await modelCacheStorage()?.open(MEANING_CACHE);
  installed = Boolean(cache);
  if (cache) for (const file of Object.keys(MEANING_MODEL_ASSETS)) {
    const url = MEANING_MODEL_BASE + file;
    if (!(cache.has ? await cache.has(url) : (await cache.match(url))?.ok)) installed = false;
  }
  if (!installed && phase !== 'downloading') { phase = 'not-installed'; message = 'Download the merge model to compare meanings locally.'; }
  emit(); return installed;
}
export async function downloadMeaningModel() {
  if (downloading) return downloading;
  downloading = (async () => {
    phase = 'downloading'; message = 'Downloading merge model…'; emit();
    const total = downloadBytes(); let completed = 0;
    downloadProgress = { loaded: 0, total, stage: 'downloading' }; emit();
    const cache = await modelCacheStorage()?.open(MEANING_CACHE);
    if (!cache) throw new Error('Model storage is unavailable.');
    for (const [file, asset] of Object.entries(MEANING_MODEL_ASSETS)) {
      const url = MEANING_MODEL_BASE + file;
      if (cache.has ? await cache.has(url) : (await cache.match(url))?.ok) { completed += asset.bytes; continue; }
      message = `Downloading merge model: ${file}…`; emit();
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Merge model download failed (${response.status}).`);
      const bytes = await readModelDownload(response, { total: asset.bytes, onProgress: detail => {
        downloadProgress = { loaded: completed + detail.loaded, total, stage: 'downloading' }; emit();
      } });
      downloadProgress = { loaded: completed + bytes.byteLength, total, stage: 'verifying' }; emit();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== asset.bytes || hash !== asset.sha256) throw new Error(`Merge model checksum failed: ${file}.`);
      await cache.put(url, new Response(bytes, { headers: { 'Content-Length': String(bytes.byteLength), 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' } }));
      completed += asset.bytes;
    }
    installed = true;
    return await preloadMeaningModel();
  })().catch(error => { phase = 'error'; message = error.message; emit(); throw error; }).finally(() => { downloading = null; });
  return downloading;
}
export async function removeMeaningModel() {
  if (downloading) throw new Error('Wait for the merge model download to finish.');
  stop(new Error('The merge model was removed.'));
  await modelCacheStorage()?.delete(MEANING_CACHE);
  installed = false; phase = 'not-installed'; downloadProgress = null; message = 'Merge model files removed.'; emit();
}
function stop(error) {
  worker?.terminate(); worker = null;
  for (const item of pending.values()) { item.cleanup(); item.reject(error); }
  pending.clear();
}
function rpc(payload, { signal } = {}) {
  signal?.throwIfAborted();
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Web Workers are unavailable.'));
  if (!worker) {
    const active = worker = new Worker(new URL('../ml/meaningWorker.bundle.js', import.meta.url), { type: 'module' });
    active.onmessage = ({ data }) => {
      if (worker !== active) return;
      if (data.type === 'model-cache') { void handleModelCacheRequest(active, data); return; }
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id); item.cleanup();
      if (data.error) item.reject(new Error(data.error));
      else if (data.result?.model !== MEANING_MODEL_TAG) item.reject(new Error('Meaning model identity mismatch.'));
      else item.resolve(data.result);
    };
    active.onerror = () => { if (worker === active) stop(new Error('The meaning model could not start.')); };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => { pending.delete(id); cleanup(); reject(signal.reason || new Error('Meaning comparison cancelled.')); };
    const timer = setTimeout(() => stop(new Error('Meaning comparison timed out.')), 90_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener('abort', abort, { once: true });
    try { worker.postMessage({ id, ...payload }); }
    catch (error) { pending.delete(id); cleanup(); reject(error); }
  });
}
export function preloadMeaningModel() {
  if (phase === 'ready' && worker) return Promise.resolve({ model: MEANING_MODEL_TAG });
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    if (!await checkMeaningModelInstalled()) return null;
    phase = 'loading'; message = 'Loading merge model…'; emit();
    downloadProgress = { loaded: downloadBytes(), total: downloadBytes(), stage: 'loading' }; emit();
    const result = await rpc({ type: 'initialize' });
    phase = 'ready'; message = 'Merge model ready. Meanings are compared on this device.'; emit(); return result;
  })().catch(error => { phase = 'error'; message = error.message; emit(); throw error; }).finally(() => { preloadPromise = null; });
  return preloadPromise;
}
export async function scoreReferenceMeaningPairs(senses, pairs, options = {}) {
  if (!installed && !await checkMeaningModelInstalled()) {
    const error = new Error('Download the merge model in Settings to compare meanings locally.');
    error.code = 'NOT_INSTALLED';
    throw error;
  }
  const texts = senses.map(sense => meaningEmbeddingText(sense.sourceDefinition || sense.definition));
  const result = await rpc({ type: 'compare', texts, pairs }, options);
  if (!Array.isArray(result.scores) || result.scores.length !== pairs.length || result.scores.some(score => !Number.isFinite(score) || score < 0 || score > 1)) throw new Error('Invalid meaning model scores.');
  phase = 'ready'; message = 'Merge model ready. Meanings are compared on this device.'; emit();
  return result.scores;
}
