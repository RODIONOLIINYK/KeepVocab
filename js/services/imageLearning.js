import { driveSync } from './driveSync.js?v=18800';
import { prepareImageThumbnails } from './imageThumbnails.js?v=18800';
import { base64ToBytes } from '../utils/base64.js';
import { CLIP_TAG, CLIP_CACHE, VECTOR_DB, MODEL_DOWNLOAD_MB } from '../ml/clipConfig.js';
import { cosine, preferenceFeatures, encodeFeatures, decodeFeatures, mergeImageLearning, updatePreferenceModel, preferenceProbability } from './imagePreferences.js';

const CONFIG_KEY = 'keepvocab_image_learning_device_v1';
const MODEL_KEY = 'keepvocab_image_preference_model_v1';
let worker;
let preferCPU = false;
let nextId = 0;
let idleTimer;
let phase = 'off';
let message = '';
let backend = '';
const pending = new Map();
const listeners = new Set();
function emit(detail = {}) { for (const listener of listeners) listener({ ...getImageLearningStatus(), ...detail }); }
export function subscribeImageLearning(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function imageLearningEnabled(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(CONFIG_KEY) || '{}').enabled === true; } catch { return false; }
}
function savedModel() {
  try { const model = JSON.parse(globalThis.localStorage?.getItem(MODEL_KEY) || 'null');
    return model?.model === CLIP_TAG && model.weights?.length === 516 && model.weights.every(Number.isFinite) ? model : null;
  } catch { return null; }
}
function dataset() { return mergeImageLearning(driveSync.getSettings().imageLearning); }
function trainedModel() {
  const state = updatePreferenceModel(dataset(), savedModel());
  if (globalThis.localStorage) {
    if (state.model) localStorage.setItem(MODEL_KEY, JSON.stringify(state.model)); else localStorage.removeItem(MODEL_KEY);
  }
  return state;
}
export function getImageLearningStatus() {
  const data = dataset();
  const model = savedModel();
  return { enabled: imageLearningEnabled(), phase, message, backend, downloadMB: MODEL_DOWNLOAD_MB,
    labels: data.records.length, revision: model?.revision || 0, trainedLabels: model?.trainedLabels || 0,
    queued: data.records.filter(record => !model?.trainedRecordIds?.includes(`${record.id}|${record.updatedAt}|${record.label}|${record.features}`)).length,
    changedParameters: model?.changedParameters || 0, deltaL2: model?.deltaL2 || 0,
    fingerprint: model?.fingerprint || '', beforeFingerprint: model?.beforeFingerprint || '' };
}
function stopWorker(reason = 'The local image model was stopped.') {
  clearTimeout(idleTimer);worker?.terminate();worker = null;
  for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup();item.reject(new Error(reason)); }
  pending.clear();
}
function rpc(type, payload = {}, { signal, allowMetered = false } = {}) {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run the local image model.'));
  if (signal?.aborted) return Promise.reject(new Error('Image scoring was cancelled.'));
  clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(new URL('../ml/clipWorker.bundle.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') { phase = data.phase || phase;message = data.message || message;backend = data.backend || backend;emit(data);return; }
      const item = pending.get(data.id);if (!item) return;
      pending.delete(data.id);clearTimeout(item.timer);item.cleanup();
      if (data.error) item.reject(Object.assign(new Error(data.error), { backendFailure: data.backendFailure })); else item.resolve(data.result);
      if (!pending.size) idleTimer = setTimeout(() => { stopWorker(); phase = 'idle'; emit(); }, 120_000);
    };
    worker.onerror = () => { phase = 'error';message = 'Local image inference failed. Metadata search is still available.';stopWorker(message);emit(); };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => { worker?.postMessage({ type: 'cancel', id }); const item = pending.get(id);if (!item) return; pending.delete(id);clearTimeout(item.timer);item.cleanup();reject(new Error('Image scoring was cancelled.')); };
    const timer = setTimeout(() => { phase = 'error';message = 'The local model timed out. Try again on a reliable connection.';stopWorker(message);emit(); }, 180_000);
    const connection = globalThis.navigator?.connection;
    pending.set(id, { resolve, reject, timer, cleanup: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id, type, payload, device: preferCPU ? 'wasm' : 'auto', allowDownloads: allowMetered || !(connection?.saveData || connection?.type === 'cellular') });
  }).catch(error => {
    if (error.backendFailure && !preferCPU) { preferCPU = true; stopWorker('Switching to CPU inference.'); return rpc(type, payload, { signal, allowMetered }); }
    throw error;
  });
}
export async function enableImageLearning(options = {}) {
  if (options.device) {
    if (!['auto', 'wasm'].includes(options.device)) throw new Error('Unsupported inference backend.');
    stopWorker(); preferCPU = options.device === 'wasm';
  }
  globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify({ enabled: true }));
  phase = 'loading';message = 'Downloading the local image model…';emit();
  try { const result = await rpc('initialize', {}, options);trainedModel();phase = 'ready';message = 'Local image scoring is ready.';backend = result.backend;emit();return getImageLearningStatus(); }
  catch (error) { phase = 'error';message = error.message;emit();throw error; }
}
export function disableImageLearning() {
  globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify({ enabled: false }));stopWorker();phase = 'off';message = 'Local image scoring is off.';emit();
}
export async function clearImageModelDownloads() {
  disableImageLearning();
  await globalThis.caches?.delete(CLIP_CACHE);
  if (globalThis.indexedDB) await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(VECTOR_DB);
    request.onsuccess = resolve;request.onerror = () => reject(new Error('Could not clear image vectors.'));
    request.onblocked = () => reject(new Error('Close other KeepVocab windows before clearing model data.'));
  });
}
export function resetImagePreferences() {
  const data = dataset();
  const resetAt = new Date(Math.max(Date.now(), ...data.records.map(record => Date.parse(record.updatedAt) + 1), (Date.parse(data.resetAt) || 0) + 1)).toISOString();
  driveSync.updateSettings({ imageLearning: { version: 1, resetAt, records: [] } });
  globalThis.localStorage?.removeItem(MODEL_KEY);emit();
}
const fingerprint = word => JSON.stringify([String(word.word || '').trim().toLowerCase(), String(word.partOfSpeech || '').trim().toLowerCase(), String(word.sourceDefinition || word.definition || '').replace(/\s+/g, ' ').trim()]);
function prompts(word, options) {
  const selected = `A photo illustrating ${word.word} (${word.partOfSpeech || 'word'}): ${word.definition || word.sourceDefinition}`;
  const scenes = (options.scenes || word.imageScenes?.scenes || []).slice(0, 3).map(scene => `A photo of ${scene}`);
  const alternatives = [...new Set([...(options.otherDefinitions || []), ...(word.otherDefinitions || [])])].filter(value => value && value !== word.definition && value !== word.sourceDefinition).slice(0, 8).map(value => `A photo illustrating ${word.word}: ${value}`);
  return { texts: [selected, ...scenes, ...alternatives, 'Text, a logo, a diagram, a screenshot or a document.'].map(text => text.slice(0, 2000)), sceneCount: scenes.length, alternativeCount: alternatives.length };
}
export function semanticScores(image, texts, sceneCount, alternativeCount) {
  const direct = cosine(image, texts[0]);
  const scene = sceneCount ? Math.max(...texts.slice(1, 1 + sceneCount).map(text => cosine(image, text))) : direct;
  const selected = 0.7 * direct + 0.3 * scene;
  const contrast = alternativeCount ? Math.max(...texts.slice(1 + sceneCount, 1 + sceneCount + alternativeCount).map(text => cosine(image, text))) : null;
  const margin = contrast === null ? 0 : selected - contrast;
  const unwanted = cosine(image, texts.at(-1));
  return { selected, contrast, margin, unwanted, score: selected + (contrast === null ? 0 : 0.6 * margin) - 0.25 * Math.max(0, unwanted) };
}
export function rankEmbeddedImages(items, model = null) {
  const scored = items.map((item, index) => {
    const features = preferenceFeatures(item.vector, item.semantic);
    const probability = preferenceProbability(model, features);
    // Early feedback should have little influence. A visual preference must not
    // positively reward an image that matches another supplied sense better.
    const strength = 0.12 * Math.min(1, (model?.trainedLabels || 0) / 64);
    const preference = item.semantic.margin < 0 ? Math.min(0, probability - 0.5) : probability - 0.5;
    return { ...item, index, features, probability, score: item.semantic.score + strength * preference + 0.03 / (index + 1) };
  });
  const selected = [];
  while (scored.length) {
    scored.sort((a, b) => {
      const score = item => item.score - (selected.length ? 0.10 * Math.max(...selected.map(chosen => Math.max(0, cosine(chosen.vector, item.vector)))) : 0);
      return score(b) - score(a) || a.index - b.index;
    });
    const candidate = scored.shift();
    if (!selected.some(item => cosine(item.vector, candidate.vector) > 0.97)) selected.push(candidate);
  }
  return selected;
}
export async function rankImagesLocally(word, candidates, options = {}) {
  if (!imageLearningEnabled(options.storage) || !candidates.length) return candidates;
  try {
    const prompt = prompts(word, options);
    const texts = await rpc('texts', { texts: prompt.texts }, options);
    const items = [];
    for (let offset = 0; offset < Math.min(40, candidates.length); offset += 4) {
      if (options.signal?.aborted || !imageLearningEnabled()) return candidates;
      const thumbnails = await prepareImageThumbnails(candidates.slice(offset, offset + 4), options);
      for (const thumbnail of thumbnails) {
        const vector = await rpc('image', { blob: new Blob([base64ToBytes(thumbnail.inlineData.data)], { type: thumbnail.inlineData.mimeType }) }, options);
        items.push({ candidate: thumbnail.candidate, vector, semantic: semanticScores(vector, texts, prompt.sceneCount, prompt.alternativeCount) });
      }
      phase = 'scoring';message = `Scored ${items.length} of ${candidates.length} image suggestions locally.`;emit();
    }
    const model = trainedModel().model;
    const scored = rankEmbeddedImages(items, model);
    const scoredImages = new Set(items.map(item => item.candidate));
    phase = 'ready';message = `${items.length} image suggestions scored locally.`;emit();
    return [...scored.map(item => ({ ...item.candidate, ml: { model: CLIP_TAG, sense: fingerprint(word), features: encodeFeatures(item.features),
      selected: item.semantic.selected, margin: item.semantic.margin, unwanted: item.semantic.unwanted, preference: item.probability, score: item.score } })),
      ...candidates.filter(item => !scoredImages.has(item))];
  } catch (error) { phase = 'error';message = `${error.message} Metadata search is still available.`;emit();return candidates; }
}
let feedbackQueue = Promise.resolve();
export function recordImagePreference(word, action, image) {
  if (!['good', 'wrong'].includes(action) || !image || !imageLearningEnabled()) return Promise.resolve({ recorded: false, reason: 'No explicit training label.' });
  const operation = async () => {
    let candidate = image;
    if (candidate.ml?.model !== CLIP_TAG || candidate.ml.sense !== fingerprint(word)) candidate = (await rankImagesLocally(word, [image]))[0];
    if (!candidate?.ml || candidate.ml.sense !== fingerprint(word)) return { recorded: false, reason: 'Image pixels were unavailable; preference weights were unchanged.' };
    try { decodeFeatures(candidate.ml.features); } catch { return { recorded: false, reason: 'Invalid image features; preference weights were unchanged.' }; }
    const idBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([fingerprint(word), image.sourceUrl || image.url])));
    const id = Array.from(new Uint8Array(idBytes), value => value.toString(16).padStart(2, '0')).join('');
    const data = dataset();
    const label = action === 'good' ? 1 : 0;
    const existing = data.records.find(record => record.id === id);
    if (existing?.label === label && existing.features === candidate.ml.features) return { recorded: false, reason: 'This label was already recorded.' };
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(existing?.updatedAt || data.resetAt || '') + 1 || 0)).toISOString();
    const next = mergeImageLearning(data, { records: [{ id, model: CLIP_TAG, label, features: candidate.ml.features, updatedAt }] });
    driveSync.updateSettings({ imageLearning: next });
    const state = trainedModel();emit();
    return { recorded: true, trained: state.trained, queued: state.queued, changedParameters: state.model?.changedParameters || 0, deltaL2: state.model?.deltaL2 || 0,
      revision: state.model?.revision || 0, reason: state.trained ? `Trained revision ${state.model.revision}; ${state.model.changedParameters} parameters changed.` : `Label saved; ${state.queued} labels queued. Training starts with 8 labels and both Good and Wrong examples, then batches of 4.` };
  };
  feedbackQueue = feedbackQueue.catch(() => {}).then(operation);
  return feedbackQueue;
}
