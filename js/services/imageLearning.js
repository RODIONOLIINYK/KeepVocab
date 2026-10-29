import { driveSync } from './driveSync.js?v=18900';
import { prepareImageThumbnails } from './imageThumbnails.js?v=18900';
import { base64ToBytes } from '../utils/base64.js';
import { CLIP_TAG, CLIP_CACHE, CLIP_DOWNLOAD_URLS, VECTOR_DB, MODEL_DOWNLOAD_MB } from '../ml/clipConfig.js';
import { cosine, preferenceFeatures, encodeFullFeatures, decodeFeatures, mergeImageLearning, preferenceProbability } from './imagePreferences.js';

const CONFIG_KEY = 'keepvocab_image_learning_device_v1';
const MODEL_KEY = 'keepvocab_image_preference_model_v1';
import { IMAGE_PREPROCESSING, encodeMeaning, personalizerScore, validPersonalizer } from './imagePersonalizer.js';
import { ImagePersonalizerTraining } from './imagePersonalizerTraining.js';
import { scheduleImageModelWarmup } from './imageModelStartup.js';
let trainingInstance;
function training() { return trainingInstance ||= new ImagePersonalizerTraining(driveSync); }
let cachedModel = null;
const recentRecords = new Map();
let worker;
let preferCPU = false;
let nextId = 0;
let cancelStartupWarmup = null;
let warmupPromise = null;
let workerReady = false;
let workerGeneration = 0;
let featureGeneration = 0;
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
function startupDownloadAllowed(storage) {
  const connection = globalThis.navigator?.connection;
  return downloadConsent(storage) && globalThis.navigator?.onLine !== false && !connection?.saveData && connection?.type !== 'cellular';
}
export async function hasDownloadedImageModel(cacheStorage = globalThis.caches) {
  try {
    if (!cacheStorage || !(await cacheStorage.keys()).includes(CLIP_CACHE)) return false;
    const cache = await cacheStorage.open(CLIP_CACHE);
    const files = await Promise.all(CLIP_DOWNLOAD_URLS.map(url => cache.match(url)));
    return files.every(response => response?.ok && response.headers?.get('content-length') !== '0');
  } catch { return false; }
}
// Check cached files first; defer optional model initialization until after paint/idle.
export async function initializeImageLearning({ requestDownload, storage = globalThis.localStorage, cacheStorage = globalThis.caches, enable = enableImageLearning, scheduleWarmup = scheduleImageModelWarmup } = {}) {
  installed = await hasDownloadedImageModel(cacheStorage);
  const config = deviceConfig(storage);
  if (installed) {
    if (config.enabled !== false) {
      saveDeviceConfig({ enabled: true, prompted: true, downloadConsent: downloadConsent(storage) ? 'accepted' : 'not-requested' }, storage);
      if (!worker) { phase = 'idle'; message = 'Installed. Image suggestions will be scored locally.'; }
      queueModelWarmup({ storage }, scheduleWarmup);
    }
    emit();
    return { installed: true, prompted: false, enabled: imageLearningEnabled(storage) };
  }
  if (config.enabled === true && downloadConsent(storage)) {
    saveDeviceConfig({ prompted: true, downloadConsent: 'accepted' }, storage);
    // An approved installation can be missing a newly pinned tower after an
    // upgrade. Prepare it after paint/idle, under the same network policy.
    if (startupDownloadAllowed(storage)) queueModelWarmup({ storage, cachedOnly: false }, scheduleWarmup);
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
function dataset() { return mergeImageLearning(driveSync.getSettings().imageLearning); }
export function getImageLearningStatus() {
  const history = driveSync.imageHistory;
  const data = [...recentRecords.values()];
  return { enabled: imageLearningEnabled(), installed, phase, message, backend, downloadMB: MODEL_DOWNLOAD_MB,
    labels: Math.max(history.count, dataset().records.length), revision: cachedModel?.revision || 0,
    trainedLabels: cachedModel?.trainingDecisionIds?.length || 0, queued: 0,
    positiveLabels: history.summary?.positive || data.filter(r => r.label === 1).length,
    negativeLabels: history.summary?.negative || data.filter(r => r.label === 0 && r.kind !== 'comparison').length,
    comparisons: history.summary?.comparisons || data.filter(r => r.kind === 'comparison').length,
    historyWarning: history.error, trainingReport: training().report };
}
export async function getImageLearningTrainingData() {
  const records = await driveSync.getImageEvents();
  return { exportedAt: new Date().toISOString(), records: records.map(record => ({ ...record,
    labelValue: record.label, label: record.kind === 'comparison' ? 'less preferred' : record.label ? 'fits meaning' : 'wrong meaning' })),
    model: await training().current(), report: training().report };
}
export async function trainPersonalImageModel(options = {}) {
  const result = await training().train(options); cachedModel = await training().current(); emit(); return result;
}
function cancelScheduledWarmup() {
  cancelStartupWarmup?.(); cancelStartupWarmup = null;
}
function queueModelWarmup(options, schedule) {
  if (worker || cancelStartupWarmup || typeof Worker === 'undefined') return;
  const generation = workerGeneration;
  cancelStartupWarmup = schedule(() => {
    cancelStartupWarmup = null;
    if (generation !== workerGeneration || !imageLearningEnabled(options.storage) || worker) return;
    if (options.cachedOnly === false && !startupDownloadAllowed(options.storage)) return;
    // The callback only posts work. Graph loading/compilation stays in the worker.
    void warmImageLearning(options).catch(() => {});
  });
}
export function warmImageLearning(options = {}) {
  if (!imageLearningEnabled(options.storage) || typeof Worker === 'undefined') return Promise.resolve(getImageLearningStatus());
  if (warmupPromise) return warmupPromise;
  if (worker && workerReady) return Promise.resolve(getImageLearningStatus());
  const generation = featureGeneration;
  const lifecycle = {};
  const current = () => generation === featureGeneration && (lifecycle.workerGeneration === undefined || lifecycle.workerGeneration === workerGeneration) && imageLearningEnabled(options.storage);
  phase = 'loading'; message = 'Preparing image suggestions…'; emit();
  const operation = rpc('initialize', {}, { ...options, cachedOnly: options.cachedOnly !== false, lifecycle }).then(async result => {
    if (!current() || !workerReady) return getImageLearningStatus();
    const model = await training().current();
    if (!current() || !workerReady) return getImageLearningStatus();
    cachedModel = model;
    installed = true; workerReady = true; phase = 'ready'; message = 'Local image scoring is ready.'; backend = result.backend; emit();
    return getImageLearningStatus();
  }).catch(error => {
    if (current()) { phase = 'error'; message = error.message; emit(); }
    throw error;
  }).finally(() => { if (warmupPromise === operation) warmupPromise = null; });
  warmupPromise = operation; return operation;
}
function stopWorker(reason = 'The local image model was stopped.') {
  cancelScheduledWarmup(); workerGeneration++; workerReady = false; warmupPromise = null;
  worker?.terminate(); worker = null;
  for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup(); item.reject(new Error(reason)); }
  pending.clear();
}
function rpc(type, payload = {}, { signal, allowMetered = false, cachedOnly = false, storage, lifecycle } = {}) {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run the local image model.'));
  if (signal?.aborted) return Promise.reject(new Error('Image scoring was cancelled.'));
  const generation = featureGeneration;
  cancelScheduledWarmup();
  if (!worker) {
    const activeWorker = worker = new Worker(new URL('../ml/clipWorker.bundle.js', import.meta.url), { type: 'module' });
    activeWorker.onmessage = ({ data }) => {
      if (worker !== activeWorker) return;
      if (data.type === 'status') {
        phase = data.phase || phase;message = data.message || message;backend = data.backend || backend;
        // Searches can initialize the model lazily, without the Settings enable
        // action. A ready worker is stronger evidence than an earlier cache check.
        if (data.phase === 'ready') { installed = true; workerReady = true; }
        emit(data);return;
      }
      const item = pending.get(data.id);if (!item) return;
      pending.delete(data.id);clearTimeout(item.timer);item.cleanup();
      if (data.error) item.reject(Object.assign(new Error(data.error), { backendFailure: data.backendFailure }));
      else { workerReady = true; item.resolve(data.result); }
      // Retain the worker and loaded graphs for this app session. Idle is not teardown.
    };
    activeWorker.onerror = () => { if (worker !== activeWorker) return; phase = 'error';message = 'Local image inference failed. Metadata search is still available.';stopWorker(message);emit(); };
  }
  // The same request may move to a CPU worker. Its caller must follow that
  // replacement, while ignoring unrelated workers created after it was stopped.
  if (lifecycle) lifecycle.workerGeneration = workerGeneration;
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => { worker?.postMessage({ type: 'cancel', id }); const item = pending.get(id);if (!item) return; pending.delete(id);clearTimeout(item.timer);item.cleanup();reject(new Error('Image scoring was cancelled.')); };
    const timer = setTimeout(() => { phase = 'error';message = 'The local model timed out. Try again on a reliable connection.';stopWorker(message);emit(); }, 180_000);
    const connection = globalThis.navigator?.connection;
    pending.set(id, { resolve, reject, timer, cleanup: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id, type, payload, device: preferCPU ? 'wasm' : 'auto', allowDownloads: !cachedOnly && downloadConsent(storage) && (allowMetered || !(connection?.saveData || connection?.type === 'cellular')) });
  }).catch(error => {
    if (generation === featureGeneration && error.backendFailure && !preferCPU) { preferCPU = true; stopWorker('Switching to CPU inference.'); return rpc(type, payload, { signal, allowMetered, cachedOnly, storage, lifecycle }); }
    throw error;
  });
}
export async function enableImageLearning(options = {}) {
  if (options.device) {
    if (!['auto', 'wasm'].includes(options.device)) throw new Error('Unsupported inference backend.');
    featureGeneration++; stopWorker(); preferCPU = options.device === 'wasm';
  }
  saveDeviceConfig({ enabled: true, prompted: true, downloadConsent: options.download === false && !downloadConsent(options.storage) ? 'not-requested' : 'accepted' }, options.storage);
  phase = 'loading';message = installed ? 'Loading the installed image model…' : 'Downloading the local image model…';emit();
  const generation = featureGeneration;
  const lifecycle = {};
  const current = () => generation === featureGeneration && (lifecycle.workerGeneration === undefined || lifecycle.workerGeneration === workerGeneration) && imageLearningEnabled(options.storage);
  try {
    const result = await rpc('initialize', {}, { ...options, lifecycle });
    if (!current() || !workerReady) return getImageLearningStatus();
    const model = await training().current();
    if (!current() || !workerReady) return getImageLearningStatus();
    installed = true; workerReady = true; cachedModel = model;
    phase = 'ready'; message = 'Local image scoring is ready.'; backend = result.backend; emit(); return getImageLearningStatus();
  } catch (error) {
    if (current()) { phase = 'error'; message = error.message; emit(); }
    throw error;
  }
}
export function disableImageLearning() {
  featureGeneration++; training().stop(); saveDeviceConfig({ enabled: false, prompted: true });stopWorker();phase = 'off';message = 'Local image scoring is off. You can enable it again in Settings.';emit();
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
export async function resetImagePreferences() {
  training().stop(); cachedModel = null; recentRecords.clear();
  await feedbackQueue.catch(() => {});
  const records = await driveSync.getImageEvents();
  const resetAt = new Date(records.reduce((latest, record) => Math.max(latest, Date.parse(record.updatedAt) || 0), Date.now()) + 1).toISOString();
  driveSync.updateSettings({ imageLearning: { version: 1, resetAt, records: [] } });
  await driveSync.imageHistory.merge([], resetAt); await driveSync.imageHistory.saveModel(null);
  globalThis.localStorage?.removeItem(MODEL_KEY); emit();
}
const fingerprint = word => JSON.stringify([String(word.word || '').trim().toLowerCase(), String(word.partOfSpeech || '').trim().toLowerCase(), String(word.sourceDefinition || word.definition || '').replace(/\s+/g, ' ').trim()]);
export function imageClipPrompts(word, options = {}) {
  const selected = `A photo illustrating ${word.word} (${word.partOfSpeech || 'word'}): ${word.definition || word.sourceDefinition}`;
  const rawScenes = [...new Set([...(options.extraQueries || []), ...(options.scenes || []), ...(word.imageScenes?.scenes || [])].map(s => String(s).trim()).filter(Boolean))].slice(0, 3);
  const scenes = rawScenes.map(scene => `A photo of ${scene}`);
  const alternatives = [...new Set([...(options.otherDefinitions || []), ...(word.otherDefinitions || [])])].filter(value => value && value !== word.definition && value !== word.sourceDefinition).slice(0, 8).map(value => `A photo illustrating ${word.word}: ${value}`);
  const contrasts = (word.imageScenes?.contrasts || []).slice(0, 2).map(scene => `A photo of ${scene}`);
  return { scenes: rawScenes, texts: [selected, ...scenes, ...alternatives, ...contrasts, 'Text, a logo, a diagram, a screenshot or a document.'].map(text => text.slice(0, 2000)), sceneCount: scenes.length, alternativeCount: alternatives.length + contrasts.length };
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
    const neural = validPersonalizer(model) && item.meaningFeatures;
    const adjustment = neural ? personalizerScore(model, encodeFullFeatures(features), item.meaningFeatures) - personalizerScore(null, encodeFullFeatures(features), item.meaningFeatures) : 0;
    const probability = neural ? Math.max(0, Math.min(1, 0.5 + adjustment / .16)) : preferenceProbability(model, features);
    // Early feedback should have little influence. A visual preference must not
    // positively reward an image that matches another supplied sense better.
    const strength = 0.12 * Math.min(1, (model?.trainedLabels || 0) / 64);
    const preference = item.semantic.margin < 0 ? Math.min(0, probability - 0.5) : probability - 0.5;
    return { ...item, index, features, probability, score: item.semantic.score + (neural ? adjustment : strength * preference) };
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
  const generation = featureGeneration;
  const lifecycle = {};
  const current = () => generation === featureGeneration && imageLearningEnabled(options.storage) && !options.signal?.aborted
    && (lifecycle.workerGeneration === undefined || lifecycle.workerGeneration === workerGeneration);
  const inference = { ...options, lifecycle };
  try {
    // Let startup finish its GPU-to-CPU recovery before adding picker requests
    // to the worker queue: replacing a failed worker rejects its pending RPCs.
    if (warmupPromise) {
      try { await warmupPromise; } catch { return candidates; }
      if (!current() || !workerReady) return candidates;
    }
    const prompt = imageClipPrompts(word, options);
    const texts = await rpc('texts', { texts: prompt.texts }, inference);
    if (!current() || !workerReady) return candidates;
    const meaningFeatures = encodeMeaning(texts[0]);
    const items = [];
    // A six-photo chooser needs a small shortlist, not forty serial inferences.
    const scoringLimit = Math.min(candidates.length, Math.max(4, Math.min(40, Number(options.localCandidateLimit) || 12)));
    for (let offset = 0; offset < scoringLimit; offset += 4) {
      if (!current()) return candidates;
      const thumbnails = await prepareImageThumbnails(candidates.slice(offset, Math.min(offset + 4, scoringLimit)), { ...options, preferOriginal: true });
      if (!current()) return candidates;
      for (const thumbnail of thumbnails) {
        if (!current()) return candidates;
        const vector = await rpc('image', { blob: new Blob([base64ToBytes(thumbnail.inlineData.data)], { type: thumbnail.inlineData.mimeType }) }, inference);
        if (!current() || !workerReady) return candidates;
        items.push({ candidate: thumbnail.candidate, vector, meaningFeatures, semantic: semanticScores(vector, texts, prompt.sceneCount, prompt.alternativeCount) });
      }
      phase = 'scoring';message = `Scored ${items.length} of ${candidates.length} image suggestions locally.`;emit();
    }
    const model = await training().current();
    if (!current() || !workerReady) return candidates;
    cachedModel = model;
    const scored = rankEmbeddedImages(items, model);
    const scoredImages = new Set(items.map(item => item.candidate));
    phase = 'ready';message = `${items.length} image suggestions scored locally.`;emit();
    return [...scored.map(item => ({ ...item.candidate, ml: { model: CLIP_TAG, sense: fingerprint(word), features: encodeFullFeatures(item.features), meaningFeatures, preprocessing: IMAGE_PREPROCESSING, scenes: prompt.scenes,
      selected: item.semantic.selected, contrast: item.semantic.contrast, margin: item.semantic.margin, unwanted: item.semantic.unwanted, preference: item.probability, trainedLabels: model?.trainedLabels || 0,
      trainedComparisons: model?.trainedComparisons || 0, trainedPositiveLabels: model?.trainedPositiveLabels || 0, trainedNegativeLabels: model?.trainedNegativeLabels || 0, score: item.score } })),
      ...candidates.filter(item => !scoredImages.has(item))];
  } catch (error) { if (current()) { phase = 'error';message = `${error.message} Metadata search is still available.`;emit(); } return candidates; }
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
export function recordImagePreference(word, action, image, { preferredImage, decisionId } = {}) {
  if (!['good', 'wrong', 'less-preferred'].includes(action) || !image || !imageLearningEnabled()
    || action === 'less-preferred' && !preferredImage?.url) return Promise.resolve({ recorded: false, reason: 'No training choice.' });
  const operation = async () => {
    await driveSync.archiveLegacyImageLearning();
    const ids = await imageRecordIds(word, image);
    if (!ids.length) return { recorded: false, reason: 'No photo available.' };
    const featuresFor = async (photo, keys) => {
      let candidate = photo;
      const existingMl = candidate.ml?.model === CLIP_TAG && candidate.ml.sense === fingerprint(word) ? candidate.ml : null;
      if (existingMl?.preprocessing === IMAGE_PREPROCESSING && existingMl.meaningFeatures) return existingMl;
      const previous = await driveSync.imageHistory.latest(keys[0]);
      if (previous?.encoder === CLIP_TAG && previous.meaningFeatures && previous.preprocessing === IMAGE_PREPROCESSING) return { ...previous, model: CLIP_TAG };
      candidate = (await rankImagesLocally(word, [photo]))[0];
      if (candidate?.ml?.model === CLIP_TAG && candidate.ml.sense === fingerprint(word)) return candidate.ml;
      return previous?.encoder === CLIP_TAG && previous.features ? previous : existingMl;
    };
    const ml = await featuresFor(image, ids);
    try { decodeFeatures(ml?.features); } catch { return { recorded: false, reason: 'Image pixels were unavailable; choice was not fabricated.' }; }
    let key = ids[0], preferred = null;
    if (action === 'less-preferred') {
      const preferredIds = await imageRecordIds(word, preferredImage);
      if (!preferredIds.length || preferredIds.some(id => ids.includes(id))) return { recorded: false, reason: 'Two different photos are needed.' };
      preferred = await featuresFor(preferredImage, preferredIds);
      try { decodeFeatures(preferred?.features); } catch { return { recorded: false, reason: 'Comparison pixels were unavailable.' }; }
      key = `comparison:${[ids[0], preferredIds[0]].sort().join(':')}`;
    }
    const previous = await driveSync.imageHistory.latest(key), label = action === 'good' ? 1 : 0;
    if (previous && (!decisionId || previous.decisionId === decisionId) && previous.label === label && previous.features === ml.features && (previous.preferredFeatures || '') === (preferred?.features || '')) return { recorded: false, reason: 'This choice was already saved.' };
    const model = await training().current();
    const meaningId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint(word)))), b => b.toString(16).padStart(2, '0')).join('');
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt || '') + 1 || 0, Date.parse(driveSync.imageHistory.resetAt || '') + 1 || 0)).toISOString();
    const record = { task: 'preference', id: crypto.randomUUID(), key, decisionId: decisionId || crypto.randomUUID(), meaningId, updatedAt, label,
      features: ml.features, ...(preferred ? { kind: 'comparison', preferredFeatures: preferred.features } : {}),
      encoder: CLIP_TAG, preprocessing: ml.preprocessing || 'legacy-center-crop', ...(ml.meaningFeatures ? { meaningFeatures: ml.meaningFeatures } : {}),
      context: { word: word.word, definition: word.sourceDefinition || word.definition, scenes: ml.scenes || word.imageScenes?.scenes || [],
        imageUrl: image.url, sourceUrl: image.sourceUrl, preferredUrl: preferredImage?.url },
      predictions: preferred && ml.meaningFeatures ? [null, model].filter((m, i) => i === 0 || m).map(m => ({ revision: m?.revision || 0,
        chosenScore: personalizerScore(m, preferred.features, ml.meaningFeatures), alternativeScore: personalizerScore(m, ml.features, ml.meaningFeatures) })) : [] };
    await driveSync.appendImageEvent(record);
    recentRecords.set(record.id, record); if (recentRecords.size > 128) recentRecords.delete(recentRecords.keys().next().value);
    training().request(); emit();
    return { recorded: true, trained: false, reason: 'Photo choice saved.' };
  };
  feedbackQueue = feedbackQueue.catch(() => {}).then(operation); return feedbackQueue;
}
