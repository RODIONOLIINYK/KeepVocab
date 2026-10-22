import { driveSync } from './driveSync.js?v=18900';
import { prepareImageThumbnails } from './imageThumbnails.js?v=18900';
import { base64ToBytes } from '../utils/base64.js';
import { CLIP_TAG, CLIP_CACHE, CLIP_DOWNLOAD_URLS, VECTOR_DB, MODEL_DOWNLOAD_MB } from '../ml/clipConfig.js';
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
let installed = false;
const pending = new Map();
const listeners = new Set();
function emit(detail = {}) { for (const listener of listeners) listener({ ...getImageLearningStatus(), ...detail }); }
export function subscribeImageLearning(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function deviceConfig(storage = globalThis.localStorage) {
  try { return JSON.parse(storage?.getItem(CONFIG_KEY) || '{}') || {}; } catch { return {}; }
}
function saveDeviceConfig(patch, storage = globalThis.localStorage) { storage?.setItem(CONFIG_KEY, JSON.stringify({ ...deviceConfig(storage), ...patch })); }
export function imageLearningEnabled(storage = globalThis.localStorage) { return deviceConfig(storage).enabled === true; }
function downloadConsent(storage = globalThis.localStorage) {
  const config = deviceConfig(storage);
  // Before consent was explicit, the only way to enable was Settings' download button.
  return config.downloadConsent === 'accepted' || (config.downloadConsent === undefined && config.enabled === true);
}
export async function hasDownloadedImageModel(cacheStorage = globalThis.caches) {
  try {
    if (!cacheStorage || !(await cacheStorage.keys()).includes(CLIP_CACHE)) return false;
    const cache = await cacheStorage.open(CLIP_CACHE);
    const files = await Promise.all(CLIP_DOWNLOAD_URLS.map(url => cache.match(url)));
    return files.every(response => response?.ok && response.headers?.get('content-length') !== '0');
  } catch { return false; }
}
// Check cached files without starting the worker or making a network request.
export async function initializeImageLearning({ requestDownload, storage = globalThis.localStorage, cacheStorage = globalThis.caches, enable = enableImageLearning } = {}) {
  installed = await hasDownloadedImageModel(cacheStorage);
  const config = deviceConfig(storage);
  if (installed) {
    if (config.enabled !== false) {
      saveDeviceConfig({ enabled: true, prompted: true, downloadConsent: downloadConsent(storage) ? 'accepted' : 'not-requested' }, storage);
      phase = 'idle'; message = 'Installed. Image suggestions will be scored locally.';
    }
    emit();
    return { installed: true, prompted: false, enabled: imageLearningEnabled(storage) };
  }
  if (config.enabled === true && downloadConsent(storage)) {
    saveDeviceConfig({ prompted: true, downloadConsent: 'accepted' }, storage);
    return { installed: false, prompted: false, enabled: true };
  }
  if (config.prompted || typeof config.enabled === 'boolean' || !requestDownload) return { installed: false, prompted: false, enabled: false };
  // Persist before showing the prompt so closing the app does not make it reappear.
  saveDeviceConfig({ enabled: false, prompted: true, downloadConsent: 'declined' }, storage);
  const accepted = await requestDownload({ downloadMB: MODEL_DOWNLOAD_MB });
  if (accepted) {
    saveDeviceConfig({ enabled: true, downloadConsent: 'accepted' }, storage);
    await enable({ allowMetered: true, storage });
  }
  emit();
  return { installed, prompted: true, enabled: imageLearningEnabled(storage) };
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
  return { enabled: imageLearningEnabled(), installed, phase, message, backend, downloadMB: MODEL_DOWNLOAD_MB,
    labels: data.records.length, revision: model?.revision || 0, trainedLabels: model?.trainedLabels || 0,
    queued: data.records.filter(record => !model?.trainedRecordIds?.includes(`${record.id}|${record.updatedAt}|${record.label}|${record.features}`)).length,
    changedParameters: model?.changedParameters || 0, deltaL2: model?.deltaL2 || 0,
    fingerprint: model?.fingerprint || '', beforeFingerprint: model?.beforeFingerprint || '' };
}
export function getImageLearningTrainingData() {
  const records = dataset().records;
  const model = savedModel();
  const trained = new Set(model?.trainedRecordIds || []);
  return {
    exportedAt: new Date().toISOString(),
    featureDescription: {
      imageEmbedding: 'features[0..511]: quantized MobileCLIP image embedding',
      selectedMeaningSimilarity: 'features[512]: similarity to the selected meaning',
      meaningMargin: 'features[513]: similarity margin against alternative meanings',
      unwantedContentSimilarity: 'features[514]: similarity to unwanted-content prompt',
      encoding: 'features are signed 8-bit values divided by 127; weights[515] is the logistic-regression intercept',
    },
    records: records.map(record => ({
      id: record.id,
      label: record.label === 1 ? 'fits meaning' : 'wrong meaning',
      labelValue: record.label,
      updatedAt: record.updatedAt,
      trainingStatus: trained.has(`${record.id}|${record.updatedAt}|${record.label}|${record.features}`) ? 'included in latest fit' : 'queued/not in latest fit',
      encodedFeatures: record.features,
      features: decodeFeatures(record.features),
    })),
    model: model ? {
      model: model.model,
      revision: model.revision,
      trainedLabels: model.trainedLabels,
      updatedAt: model.updatedAt,
      fingerprint: model.fingerprint,
      weights: model.weights,
      trainedRecordIds: model.trainedRecordIds,
    } : null,
  };
}
function stopWorker(reason = 'The local image model was stopped.') {
  clearTimeout(idleTimer);worker?.terminate();worker = null;
  for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup();item.reject(new Error(reason)); }
  pending.clear();
}
function rpc(type, payload = {}, { signal, allowMetered = false, storage } = {}) {
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
    worker.postMessage({ id, type, payload, device: preferCPU ? 'wasm' : 'auto', allowDownloads: downloadConsent(storage) && (allowMetered || !(connection?.saveData || connection?.type === 'cellular')) });
  }).catch(error => {
    if (error.backendFailure && !preferCPU) { preferCPU = true; stopWorker('Switching to CPU inference.'); return rpc(type, payload, { signal, allowMetered, storage }); }
    throw error;
  });
}
export async function enableImageLearning(options = {}) {
  if (options.device) {
    if (!['auto', 'wasm'].includes(options.device)) throw new Error('Unsupported inference backend.');
    stopWorker(); preferCPU = options.device === 'wasm';
  }
  saveDeviceConfig({ enabled: true, prompted: true, downloadConsent: options.download === false && !downloadConsent(options.storage) ? 'not-requested' : 'accepted' }, options.storage);
  phase = 'loading';message = installed ? 'Loading the installed image model…' : 'Downloading the local image model…';emit();
  try { const result = await rpc('initialize', {}, options);installed = true;trainedModel();phase = 'ready';message = 'Local image scoring is ready.';backend = result.backend;emit();return getImageLearningStatus(); }
  catch (error) { phase = 'error';message = error.message;emit();throw error; }
}
export function disableImageLearning() {
  saveDeviceConfig({ enabled: false, prompted: true });stopWorker();phase = 'off';message = 'Local image scoring is off. You can enable it again in Settings.';emit();
}
export async function clearImageModelDownloads() {
  disableImageLearning();
  await globalThis.caches?.delete(CLIP_CACHE);
  installed = false; saveDeviceConfig({ downloadConsent: 'declined' });emit();
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
    // A six-photo chooser needs a small shortlist, not forty serial inferences.
    const scoringLimit = Math.min(candidates.length, Math.max(4, Math.min(40, Number(options.localCandidateLimit) || 12)));
    for (let offset = 0; offset < scoringLimit; offset += 4) {
      if (options.signal?.aborted || !imageLearningEnabled()) return candidates;
      const thumbnails = await prepareImageThumbnails(candidates.slice(offset, Math.min(offset + 4, scoringLimit)), options);
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
      selected: item.semantic.selected, contrast: item.semantic.contrast, margin: item.semantic.margin, unwanted: item.semantic.unwanted, preference: item.probability, trainedLabels: model?.trainedLabels || 0, score: item.score } })),
      ...candidates.filter(item => !scoredImages.has(item))];
  } catch (error) { phase = 'error';message = `${error.message} Metadata search is still available.`;emit();return candidates; }
}
let feedbackQueue = Promise.resolve();
async function imageRecordIds(word, image) {
  const sense = fingerprint(word);
  const keys = [...new Set([image?.sourceUrl, image?.url].map(value => String(value || '').trim()).filter(Boolean))];
  return Promise.all(keys.map(async key => {
    const idBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([sense, key])));
    return Array.from(new Uint8Array(idBytes), value => value.toString(16).padStart(2, '0')).join('');
  }));
}
export function recordImagePreference(word, action, image) {
  if (!['good', 'wrong'].includes(action) || !image || !imageLearningEnabled()) return Promise.resolve({ recorded: false, reason: 'No explicit training label.' });
  const operation = async () => {
    const ids = await imageRecordIds(word, image);
    if (!ids.length) return { recorded: false, reason: 'Image pixels were unavailable; preference weights were unchanged.' };
    const id = ids[0];
    const idSet = new Set(ids);
    const data = dataset();
    const matching = data.records.filter(record => idSet.has(record.id));
    const existing = matching.at(-1);
    let candidate = image;
    if (candidate.ml?.model !== CLIP_TAG || candidate.ml.sense !== fingerprint(word)) candidate = (await rankImagesLocally(word, [image]))[0];
    const features = (candidate?.ml?.model === CLIP_TAG && candidate.ml.sense === fingerprint(word) && candidate.ml.features)
      || existing?.features
      || '';
    if (!features) return { recorded: false, reason: 'Image pixels were unavailable; preference weights were unchanged.' };
    try { decodeFeatures(features); } catch { return { recorded: false, reason: 'Invalid image features; preference weights were unchanged.' }; }
    const label = action === 'good' ? 1 : 0;
    if (matching.length === 1 && existing?.id === id && existing?.label === label && existing.features === features) {
      return { recorded: false, reason: 'This label was already recorded.' };
    }
    const latestExistingTime = Math.max(0, ...matching.map(record => Date.parse(record.updatedAt || '') || 0));
    const updatedAt = new Date(Math.max(Date.now(), latestExistingTime + 1, (Date.parse(data.resetAt || '') || 0) + 1)).toISOString();
    const retainedRecords = data.records.filter(record => !idSet.has(record.id));
    const next = mergeImageLearning({ ...data, records: retainedRecords }, { records: [{ id, model: CLIP_TAG, label, features, updatedAt }] });
    driveSync.updateSettings({ imageLearning: next });
    const state = trainedModel();emit();
    return { recorded: true, trained: state.trained, queued: state.queued, changedParameters: state.model?.changedParameters || 0, deltaL2: state.model?.deltaL2 || 0,
      revision: state.model?.revision || 0, reason: state.trained ? `Trained revision ${state.model.revision}; ${state.model.changedParameters} parameters changed.` : `Label saved; ${state.queued} labels queued. Training starts with 8 labels and both Good and Wrong examples, then batches of 4.` };
  };
  feedbackQueue = feedbackQueue.catch(() => {}).then(operation);
  return feedbackQueue;
}
