import { recordInferenceTimings } from './inferenceTimings.js';
import { MEANING_MODEL_TAG, MEANING_MODEL_BASE, MEANING_CACHE } from '../ml/meaningConfig.js';
import { MEANING_MODEL_ASSETS } from '../ml/meaningAssets.js';
import { meaningComparisonText, meaningEmbeddingText } from './meaningComparison.js';
import { modelCacheStorage, handleModelCacheRequest } from './modelCache.js';
import { readModelDownload } from './modelDownloadProgress.js';
import { createInferenceWorker, resetInferenceWorkers } from './inferenceWorker.js';

let worker, nextId = 0;
const pending = new Map();
const listeners = new Set();
let installed = false, phase = 'not-installed', message = 'Download the merge model to compare meanings locally.', downloading;
let downloadProgress = null, preloadPromise, installCheck, removal;
let generation = 0;
const PREVIOUS_CACHE = 'keepvocab-meaning-model-v1';
const PREVIOUS_BASE = 'https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7/resolve/be8ee3e1076958149ee7a1e0ace8615d2c43ee86/';
const PREVIOUS_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'scorer.json', 'onnx/model_fp16.onnx'];
const downloadBytes = () => Object.values(MEANING_MODEL_ASSETS).reduce((sum, file) => sum + file.bytes, 0);
export const getMeaningModelStatus = () => ({ installed, phase, message, ready: phase === 'ready', downloadProgress,
  downloadMB: Math.ceil(downloadBytes() / 1e6) });
function emit() { for (const listener of listeners) listener(getMeaningModelStatus()); }
export function subscribeMeaningModel(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function checkMeaningModelInstalled() {
  if (removal) return Promise.resolve(false);
  if (installCheck) return installCheck;
  const started = generation;
  const check = (async () => {
    const cache = await modelCacheStorage()?.open(MEANING_CACHE);
    let complete = Boolean(cache);
    for (const file of Object.keys(MEANING_MODEL_ASSETS)) {
      if (!complete || started !== generation) break;
      const url = MEANING_MODEL_BASE + file;
      complete = Boolean(cache.has ? await cache.has(url) : (await cache.match(url))?.ok);
    }
    if (started !== generation) return false;
    installed = complete;
    if (!installed && phase !== 'downloading') {
      phase = 'not-installed'; message = 'Download the merge model to compare meanings locally.';
    }
    emit();
    return installed;
  })().finally(() => { if (installCheck === check) installCheck = null; });
  installCheck = check;
  return check;
}
export async function initializeMeaningModel() {
  const started = generation;
  if (await checkMeaningModelInstalled()) return preloadMeaningModel();
  const storage = modelCacheStorage();
  if (!(await storage?.keys())?.includes(PREVIOUS_CACHE)) return null;
  const previous = await storage.open(PREVIOUS_CACHE);
  const urls = new Set((await previous.keys()).map(key => typeof key === 'string' ? key : key.url));
  if (started !== generation || removal || !PREVIOUS_FILES.every(file => urls.has(PREVIOUS_BASE + file))) return null;
  // v7 and v8 have different weights and calibration. Honor the existing
  // installation by installing the verified v8 assets shipped with the app.
  return downloadMeaningModel({ upgrade: true });
}
export async function downloadMeaningModel({ upgrade = false } = {}) {
  if (removal) await removal;
  if (downloading) return downloading;
  downloading = (async () => {
    phase = 'downloading'; message = upgrade ? 'Updating your installed merge model…' : 'Downloading merge model…'; emit();
    const total = downloadBytes(); let completed = 0;
    downloadProgress = { loaded: 0, total, stage: 'downloading' }; emit();
    const cache = await modelCacheStorage()?.open(MEANING_CACHE);
    if (!cache) throw new Error('Model storage is unavailable.');
    for (const [file, asset] of Object.entries(MEANING_MODEL_ASSETS)) {
      const url = MEANING_MODEL_BASE + file;
      if (cache.has ? await cache.has(url) : (await cache.match(url))?.ok) { completed += asset.bytes; continue; }
      message = upgrade ? 'Updating your installed merge model…' : `Downloading merge model: ${file}…`; emit();
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
    // An earlier startup check may have observed a partial installation.
    generation++;
    installCheck = null;
    preloadPromise = null;
    installed = true;
    return await preloadMeaningModel();
  })().catch(error => { phase = 'error'; message = error.message; emit(); throw error; }).finally(() => { downloading = null; });
  return downloading;
}
export async function removeMeaningModel() {
  if (downloading) throw new Error('Wait for the merge model download to finish.');
  if (removal) return removal;
  generation++;
  installed = false;
  preloadPromise = null;
  installCheck = null;
  resetInferenceWorkers('meaning');
  stop(new Error('The merge model was removed.'));
  removal = Promise.resolve().then(async () => {
    const storage = modelCacheStorage();
    await storage?.delete(PREVIOUS_CACHE);
    await storage?.delete(MEANING_CACHE);
    phase = 'not-installed'; downloadProgress = null; message = 'Merge model files removed.'; emit();
  }).catch(error => {
    phase = 'error'; message = error.message; emit(); throw error;
  }).finally(() => { removal = null; });
  return removal;
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
    const active = worker = createInferenceWorker('meaning');
    active.onmessage = ({ data }) => {
      if (worker !== active) return;
      recordInferenceTimings(data.timings);
      if (data.type === 'model-cache') { void handleModelCacheRequest(active, data); return; }
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id); item.cleanup();
      if (data.error) item.reject(new Error(data.error));
      else if (data.result?.model !== MEANING_MODEL_TAG) item.reject(new Error('Meaning model identity mismatch.'));
      else item.resolve(data.result);
    };
    active.onerror = event => {
      if (worker !== active) return;
      const removed = event?.message === 'The shared model was disabled or removed.';
      if (removed) {
        generation++;
        installCheck = null;
        preloadPromise = null;
        installed = false;
      }
      phase = removed ? 'not-installed' : 'error';
      message = removed ? 'Merge model files removed.' : 'The meaning model could not start.';
      stop(new Error(message)); emit();
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => { worker?.postMessage({ type: 'cancel', id }); pending.delete(id); cleanup(); reject(signal.reason || new Error('Meaning comparison cancelled.')); };
    const timer = setTimeout(() => {
      phase = 'error'; message = 'Meaning comparison timed out.';
      stop(new Error(message)); emit();
    }, 90_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    pending.set(id, { resolve, reject, cleanup });
    signal?.addEventListener('abort', abort, { once: true });
    try { worker.postMessage({ id, ...payload }); }
    catch (error) { pending.delete(id); cleanup(); reject(error); }
  });
}
export function preloadMeaningModel() {
  if (removal) return Promise.resolve(null);
  if (phase === 'ready' && worker) return Promise.resolve({ model: MEANING_MODEL_TAG });
  if (preloadPromise) return preloadPromise;
  const started = generation;
  const operation = (async () => {
    if ((!installed && !await checkMeaningModelInstalled()) || started !== generation) return null;
    phase = 'loading'; message = 'Loading merge model…'; emit();
    downloadProgress = { loaded: downloadBytes(), total: downloadBytes(), stage: 'loading' }; emit();
    const result = await rpc({ type: 'initialize' });
    if (started !== generation) return null;
    phase = 'ready'; message = 'Merge model ready. Meanings are compared on this device.'; emit(); return result;
  })().catch(error => {
    if (started !== generation) return null;
    phase = 'error'; message = error.message; emit(); throw error;
  }).finally(() => { if (preloadPromise === operation) preloadPromise = null; });
  preloadPromise = operation;
  return operation;
}
export async function scoreReferenceMeaningPairs(senses, pairs, options = {}) {
  const started = generation;
  if ((!installed && !await checkMeaningModelInstalled()) || started !== generation) {
    const error = new Error('Download the merge model in Settings to compare meanings locally.');
    error.code = 'NOT_INSTALLED';
    throw error;
  }
  const texts = senses.map(sense => meaningEmbeddingText(sense.sourceDefinition || sense.definition));
  const comparisonTexts = senses.map(sense => meaningComparisonText(sense.sourceDefinition || sense.definition));
  const result = await rpc({ type: 'compare', texts, comparisonTexts, pairs }, options);
  if (started !== generation) throw new Error('The merge model installation changed.');
  if (!Array.isArray(result.scores) || result.scores.length !== pairs.length || result.scores.some(score => !Number.isFinite(score) || score < 0 || score > 1)) throw new Error('Invalid meaning model scores.');
  phase = 'ready'; message = 'Merge model ready. Meanings are compared on this device.'; emit();
  return result.scores;
}
