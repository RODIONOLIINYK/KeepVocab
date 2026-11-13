import { driveSync } from './driveSync.js?v=18908';
import { IMAGE_THUMBNAIL_BATCH_LIMIT, prepareImageThumbnails } from './imageThumbnails.js?v=18908';
import { base64ToBytes } from '../utils/base64.js';
import { CLIP_TAG, CLIP_CACHE, CLIP_DOWNLOAD_URLS, VECTOR_DB, MODEL_DOWNLOAD_MB } from '../ml/clipConfig.js';
import { cosine, normalizedVector, preferenceFeatures, encodeFullFeatures, decodeFeatures, mergeImageLearning, preferenceProbability } from './imagePreferences.js';

const CONFIG_KEY = 'keepvocab_image_learning_device_v1';
const MODEL_KEY = 'keepvocab_image_preference_model_v1';
import { IMAGE_PREPROCESSING, encodeMeaning, personalizerScore, isCurrentPersonalizer } from './imagePersonalizer.js';
import { ImagePersonalizerTraining } from './imagePersonalizerTraining.js';
import { scheduleImageModelWarmup } from './imageModelStartup.js';
import { IMAGE_SEMANTIC_FILTER, passesImageSemanticGate } from './imageSemanticGate.js';
import { invariantRankingScore } from './vocabInvariantHead.js';
let trainingInstance;
function training() { return trainingInstance ||= new ImagePersonalizerTraining(driveSync); }
let cachedModel = null;
const recentRecords = new Map();
let worker;
let helpers = [];
let helpersDisabled = false;
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
let workerStorage;
let cacheEpoch = 0;
let installCheckPromise = null;
let activeInitializePromise = null;
let textEncodingDetail = null;
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
    if (!cacheStorage) return false;
    const names = await cacheStorage.keys();
    await Promise.all(names.filter(name => /^keepvocab-clip-model-v[12]$/.test(name)).map(name => cacheStorage.delete?.(name)));
    if (!names.includes(CLIP_CACHE)) return false;
    const cache = await cacheStorage.open(CLIP_CACHE);
    const activeUrls = new Set(CLIP_DOWNLOAD_URLS);
    void Promise.resolve(cache.keys?.()).then(keys => keys?.forEach(req => {
      const url = typeof req === 'string' ? req : req?.url;
      if (url && !activeUrls.has(url)) void cache.delete?.(req);
    })).catch(() => {});
    const files = await Promise.all(CLIP_DOWNLOAD_URLS.map(url => cache.match(url)));
    return files.every(response => response?.ok && response.headers?.get('content-length') !== '0');
  } catch { return false; }
}
function textEncodingStatusMessage(status, reason = '') {
  if (status === 'ready') return 'Local text encoder is ready.';
  if (status === 'installed') return 'Installed local text model is available for meaning grouping.';
  if (status === 'not-installed') return 'Local text model is not installed; no implicit download will run.';
  if (status === 'unsupported') return 'Web Workers are unavailable in this environment.';
  if (status === 'cancelled') return reason || 'Meaning text encoding was cancelled.';
  return reason || 'Local meaning text encoding failed.';
}
export function getMeaningTextEncodingStatus(options = {}) {
  const supported = typeof Worker !== 'undefined';
  const ready = supported && Boolean(worker && workerReady);
  const isInstalled = Boolean(installed || ready);
  const lastError = textEncodingDetail?.status === 'error' ? textEncodingDetail.reason || '' : '';
  const lastCancelled = textEncodingDetail?.status === 'cancelled' ? textEncodingDetail.reason || '' : '';
  const status = !supported
    ? 'unsupported'
    : ready
      ? 'ready'
      : isInstalled
        ? (lastError ? 'error' : 'installed')
        : 'not-installed';
  const reason = ['ready', 'installed'].includes(status) ? '' : lastError || lastCancelled;
  return {
    available: supported && isInstalled,
    status,
    installed: isInstalled,
    ready,
    imageLearningEnabled: imageLearningEnabled(options.storage),
    model: CLIP_TAG,
    backend: backend || '',
    reason,
    message: textEncodingStatusMessage(status, reason)
  };
}
async function resolveInstalledTextModel(options = {}) {
  if (typeof Worker === 'undefined') return false;
  if (worker && workerReady) return true;
  if (options.cacheStorage) {
    const epoch = cacheEpoch;
    const present = await hasDownloadedImageModel(options.cacheStorage);
    if (present && epoch === cacheEpoch) installed = true;
    return present;
  }
  if (installed) return true;
  if (!globalThis.caches) return false;
  if (!installCheckPromise) {
    const epoch = cacheEpoch;
    installCheckPromise = hasDownloadedImageModel(globalThis.caches).then(present => {
      if (epoch === cacheEpoch) installed = present;
      return present;
    }).finally(() => { installCheckPromise = null; });
  }
  return installCheckPromise;
}
export async function checkMeaningTextEncodingStatus(options = {}) {
  const present = await resolveInstalledTextModel(options);
  if (present && textEncodingDetail?.status === 'not-installed') textEncodingDetail = null;
  return getMeaningTextEncodingStatus(options);
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
    meaningTextEncoding: getMeaningTextEncodingStatus(),
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
  cancelScheduledWarmup(); workerGeneration++; workerReady = false; warmupPromise = null; activeInitializePromise = null; workerStorage = undefined;
  worker?.terminate(); worker = null;
  for (const helper of helpers) helper.terminate();
  helpers = [];
  for (const item of pending.values()) { clearTimeout(item.timer); item.cleanup(); item.reject(new Error(reason)); }
  pending.clear();
}
// Adaptive parallelism. One core stays free for the UI and downloads.
// Shared-memory WASM threads need cross-origin isolation; without it (the
// Electron app keeps Google sign-in popups working, Android WebView), images are
// scored concurrently by single-threaded vision-only workers. Each extra worker
// holds its own vision graph, so low-memory devices get fewer of them. Devices
// with one or two cores keep today's single worker.
export function inferencePlan(env = globalThis) {
  const cores = Math.max(1, Math.floor(Number(env.navigator?.hardwareConcurrency) || 1));
  const budget = Math.max(1, Math.min(4, cores - 1));
  if (env.crossOriginIsolated === true) return { workers: 1, threads: budget };
  const memory = Number(env.navigator?.deviceMemory);
  const memoryCap = Number.isFinite(memory) && memory > 0 ? Math.max(1, Math.floor(memory / 2)) : 2;
  return { workers: Math.min(budget, memoryCap), threads: 1 };
}
const outstanding = target => { let count = 0; for (const item of pending.values()) if (item.target === target) count++; return count; };
const leastBusy = () => [worker, ...helpers].reduce((best, target) => outstanding(target) < outstanding(best) ? target : best);
// A failed helper must not lose an image: its requests move to the primary
// worker, and helpers stay off for the rest of the session.
function retireHelpers() {
  helpersDisabled = true;
  const retired = helpers; helpers = [];
  for (const helper of retired) helper.terminate();
  for (const [id, item] of pending) {
    if (!retired.includes(item.target)) continue;
    if (!worker) { pending.delete(id); clearTimeout(item.timer); item.cleanup(); item.reject(new Error('Local image inference failed.')); continue; }
    item.target = worker;
    clearTimeout(item.timer);
    item.timer = setTimeout(item.onTimeout, item.timeoutMs);
    try {
      worker.postMessage({ ...item.message, role: undefined });
    } catch (error) {
      settle({ id, error: error.message }, worker);
    }
  }
}
function settle(data, source) {
  const item = pending.get(data.id); if (!item || item.target !== source) return;
  if (data.error && source !== worker && worker) { retireHelpers(); return; }
  pending.delete(data.id); clearTimeout(item.timer); item.cleanup();
  if (data.error) item.reject(Object.assign(new Error(data.error), { backendFailure: data.backendFailure }));
  else { workerReady = true; item.resolve(data.result); }
}
function ensureVisionHelpers() {
  const plan = inferencePlan();
  if (helpersDisabled || !worker || !workerReady || helpers.length || plan.workers <= 1 || typeof Worker === 'undefined') return;
  for (let i = 1; i < plan.workers; i++) {
    try {
      const helper = new Worker(new URL('../ml/clipWorker.bundle.js', import.meta.url), { type: 'module' });
      const initializeId = -(++nextId);
      // The primary worker owns the visible status; helpers only return vectors.
      helper.onmessage = ({ data }) => {
        if (!helpers.includes(helper) || data.type === 'status') return;
        if (data.id === initializeId && data.error) retireHelpers();
        else settle(data, helper);
      };
      helper.onerror = () => { if (helpers.includes(helper)) retireHelpers(); };
      helpers.push(helper);
      // Compile from the installed cache while the primary embeds text.
      helper.postMessage({ id: initializeId, type: 'initialize', role: 'vision', threads: 1, device: 'wasm', allowDownloads: false });
    } catch {
      retireHelpers();
      return;
    }
  }
}
function rpc(type, payload = {}, { signal, allowMetered = false, cachedOnly = false, storage, lifecycle } = {}) {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run the local image model.'));
  if (signal?.aborted) return Promise.reject(new Error('Image scoring was cancelled.'));
  const generation = featureGeneration;
  if (storage !== undefined) workerStorage = storage;
  const activeStorage = () => workerStorage === undefined ? globalThis.localStorage : workerStorage;
  if (type !== 'texts') cancelScheduledWarmup();
  if (!worker) {
    const activeWorker = worker = new Worker(new URL('../ml/clipWorker.bundle.js', import.meta.url), { type: 'module' });
    activeWorker.onmessage = ({ data }) => {
      if (worker !== activeWorker) return;
      if (data.type === 'status') {
        backend = data.backend || backend;
        // Searches can initialize the model lazily, without the Settings enable
        // action. A ready worker is stronger evidence than an earlier cache check.
        if (data.phase === 'ready') { installed = true; workerReady = true; }
        if (imageLearningEnabled(activeStorage())) {
          phase = data.phase || phase; message = data.message || message;
          emit(data);
        }
        return;
      }
      settle(data, activeWorker);
      // Retain the worker and loaded graphs for this app session. Idle is not teardown.
    };
    activeWorker.onerror = () => {
      if (worker !== activeWorker) return;
      const errorMessage = 'Local image inference failed. Metadata search is still available.';
      const imageEnabled = imageLearningEnabled(activeStorage());
      if (imageEnabled) { phase = 'error'; message = errorMessage; }
      stopWorker(errorMessage);
      if (imageEnabled) emit();
    };
  }
  // The same request may move to a CPU worker. Its caller must follow that
  // replacement, while ignoring unrelated workers created after it was stopped.
  if (lifecycle) lifecycle.workerGeneration = workerGeneration;
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => { const item = pending.get(id); (item?.target || worker)?.postMessage({ type: 'cancel', id }); if (!item) return; pending.delete(id);clearTimeout(item.timer);item.cleanup();reject(new Error('Image scoring was cancelled.')); };
    // A first installation transfers ~214 MB. Do not apply the inference timeout
    // to a valid download on a slower connection; cancellation stays available.
    const timeoutMs = type === 'initialize' && !cachedOnly ? 15 * 60_000 : 180_000;
    const onTimeout = () => {
      const item = pending.get(id);
      if (!item) return;
      if (item.target !== worker) { retireHelpers(); return; }
      const timeoutMessage = 'The local model timed out. Try again on a reliable connection.';
      const imageEnabled = imageLearningEnabled(activeStorage());
      if (imageEnabled) { phase = 'error'; message = timeoutMessage; }
      stopWorker(timeoutMessage);
      if (imageEnabled) emit();
    };
    const connection = globalThis.navigator?.connection;
    // Images go to the least busy worker; text and setup stay on the primary.
    const target = type === 'image' && helpers.length ? leastBusy() : worker;
    const helper = target !== worker;
    const message = { id, type, payload, device: preferCPU || helper ? 'wasm' : 'auto', threads: inferencePlan().threads,
      allowDownloads: !helper && !cachedOnly && downloadConsent(storage) && (allowMetered || !(connection?.saveData || connection?.type === 'cellular')),
      ...(helper ? { role: 'vision' } : {}) };
    const timer = setTimeout(onTimeout, helper ? 30_000 : timeoutMs);
    pending.set(id, { resolve, reject, timer, timeoutMs, onTimeout, target, message, cleanup: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    try { target.postMessage(message); }
    catch (error) { settle({ id, error: error.message }, target); }
  }).catch(error => {
    if (generation === featureGeneration && !signal?.aborted && error.backendFailure && !preferCPU) { preferCPU = true; stopWorker('Switching to CPU inference.'); return rpc(type, payload, { signal, allowMetered, cachedOnly, storage, lifecycle }); }
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
  const initOp = rpc('initialize', {}, { ...options, lifecycle });
  activeInitializePromise = initOp;
  try {
    const result = await initOp;
    if (!current() || !workerReady) return getImageLearningStatus();
    const model = await training().current();
    if (!current() || !workerReady) return getImageLearningStatus();
    installed = true; workerReady = true; cachedModel = model;
    if (textEncodingDetail?.status === 'not-installed' || textEncodingDetail?.status === 'error') textEncodingDetail = null;
    phase = 'ready'; message = 'Local image scoring is ready.'; backend = result.backend; emit(); return getImageLearningStatus();
  } catch (error) {
    if (current()) { phase = 'error'; message = error.message; emit(); }
    throw error;
  } finally {
    if (activeInitializePromise === initOp) activeInitializePromise = null;
  }
}
export function disableImageLearning() {
  featureGeneration++; training().stop(); saveDeviceConfig({ enabled: false, prompted: true });stopWorker();textEncodingDetail = null;phase = 'off';message = 'Local image scoring is off. You can enable it again in Settings.';emit();
}
export async function clearImageModelDownloads() {
  cacheEpoch++;
  disableImageLearning();
  await globalThis.caches?.delete(CLIP_CACHE);
  installed = false; textEncodingDetail = null; saveDeviceConfig({ downloadConsent: 'declined' });emit();
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
  await driveSync.imageHistory.writeState?.('invariantHead', null);
  globalThis.localStorage?.removeItem(MODEL_KEY); emit();
}
const fingerprint = word => JSON.stringify([String(word.word || '').trim().toLowerCase(), String(word.partOfSpeech || '').trim().toLowerCase(), String(word.sourceDefinition || word.definition || '').replace(/\s+/g, ' ').trim()]);
const VISUAL_FAMILIES = [
  ['animal', 'mammal', 'creature', 'species', 'feline', 'felidae', 'canine', 'canidae', 'bird', 'fish', 'insect', 'reptile', 'pet', 'predator', 'carnivore', 'carnivorous', 'herbivore', 'wildlife', 'fauna', 'beast', 'domestic', 'domesticate', 'domesticated', 'kitten', 'puppy'],
  ['plant', 'tree', 'flower', 'shrub', 'bush', 'herb', 'flora', 'leaf', 'blossom', 'botanical']
];
const normalizeVisualToken = token => {
  const stemmed = token.replace(/(?:ing|ed|es|s)$/, '');
  for (let i = 0; i < VISUAL_FAMILIES.length; i++) {
    if (VISUAL_FAMILIES[i].includes(token) || VISUAL_FAMILIES[i].includes(stemmed)) return `@family_${i}`;
  }
  return stemmed.length >= 3 ? stemmed : token;
};
const contentTokens = text => new Set(String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(token => token.length > 3 && !/^(?:that|this|with|from|into|have|having|make|made|used|very|more|most|some|such|when|where|which|while|person|something|someone|term|terms|relating)$/.test(token)).map(normalizeVisualToken));
function sharesVisualDefinitionTokens(candidate, target) {
  if (/^(?:\([^)]*\)\s*)*(?:terms|senses|meanings|uses) relating to\b/i.test(String(candidate || '').trim())) return true;
  const a = contentTokens(candidate), b = contentTokens(target);
  if (!a.size || !b.size) return false;
  if ([...a].some(t => t.startsWith('@family_') && b.has(t))) return true;
  const overlap = [...a].filter(token => b.has(token)).length;
  return overlap / Math.min(a.size, b.size) >= 0.4;
}
export function stripNegatedClauses(text) {
  const raw = String(text || '').trim();
  const stripped = raw
    .replace(/(?:,|;|\s+—|\s+-)\s*(?:not|never|rather than|instead of|without)\s+[^,;.]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}
export function imageClipPrompts(word, options = {}) {
  const rawDefinition = word.definition || word.sourceDefinition;
  const targetDefinition = stripNegatedClauses(rawDefinition);
  const selected = `A photo illustrating ${word.word} (${word.partOfSpeech || 'word'}): ${targetDefinition}`;
  const rawScenes = [...new Set([...(options.extraQueries || []), ...(options.scenes || []), ...(word.imageScenes?.scenes || [])].map(s => String(s).trim()).filter(Boolean))].slice(0, 3);
  const scenes = rawScenes.map(scene => `A photo of ${scene}`);
  const contrasts = [...new Set([...(options.contrasts || []), ...(word.imageScenes?.contrasts || [])].map(s => String(s).trim()).filter(Boolean))].slice(0, 3).map(scene => `A photo of ${scene}`);
  const alternatives = contrasts.length ? [] : [...new Set([...(options.otherDefinitions || []), ...(word.otherDefinitions || [])])].filter(value => value && value !== word.definition && value !== word.sourceDefinition && !sharesVisualDefinitionTokens(value, rawDefinition)).slice(0, 8).map(value => `A photo illustrating ${word.word}: ${value}`);
  return { scenes: rawScenes, texts: [selected, ...scenes, ...alternatives, ...contrasts, 'Text, a logo, a diagram, a screenshot or a document.'].map(text => text.slice(0, 2000)), sceneCount: scenes.length, alternativeCount: alternatives.length + contrasts.length,
    contrastSource: contrasts.length ? 'explicit' : alternatives.length ? 'dictionary' : null };
}
export function targetGatedCosine(imageVector, targetVector) {
  const rawCos = cosine(imageVector, targetVector);
  if (!Array.isArray(imageVector) || !Array.isArray(targetVector) || imageVector.length !== targetVector.length || !imageVector.length) return rawCos;
  const dim = targetVector.length;
  let maxAbsT = 0;
  for (let i = 0; i < dim; i++) {
    const absT = Math.abs(targetVector[i]);
    if (absT > maxAbsT) maxAbsT = absT;
  }
  if (maxAbsT > 0.5) return rawCos;
  const scale = Math.sqrt(dim);
  let gatedDot = 0, gatedImgNormSq = 0, gatedTargetNormSq = 0;
  for (let i = 0; i < dim; i++) {
    const v = imageVector[i], t = targetVector[i];
    const w = 0.5 + 0.5 * scale * Math.abs(t);
    gatedDot += w * v * t;
    gatedImgNormSq += w * v * v;
    gatedTargetNormSq += w * t * t;
  }
  const denom = Math.sqrt(Math.max(1e-12, gatedImgNormSq) * Math.max(1e-12, gatedTargetNormSq));
  return 0.65 * rawCos + 0.35 * (gatedDot / denom);
}
export function semanticScores(image, texts, sceneCount, alternativeCount, wInv = null, similarity = cosine) {
  const vBlend = Array.isArray(image) ? image : image.vector;
  const vFull = Array.isArray(image?.fullVector) ? image.fullVector : vBlend;
  const vCrop = Array.isArray(image?.cropVector) ? image.cropVector : vBlend;
  const hasMultiView = vFull !== vCrop;
  const direct = similarity(vBlend, texts[0]);
  const scene = sceneCount ? Math.max(...texts.slice(1, 1 + sceneCount).map(text => similarity(vBlend, text))) : direct;
  const sceneFull = hasMultiView ? (sceneCount ? Math.max(...texts.slice(1, 1 + sceneCount).map(text => similarity(vFull, text))) : similarity(vFull, texts[0])) : scene;
  const sceneCrop = hasMultiView ? (sceneCount ? Math.max(...texts.slice(1, 1 + sceneCount).map(text => similarity(vCrop, text))) : similarity(vCrop, texts[0])) : scene;
  const cropProminence = hasMultiView ? sceneCrop - sceneFull : 0;
  const selected = 0.7 * direct + 0.3 * scene + (hasMultiView ? 0.15 * Math.max(-0.08, Math.min(0.12, cropProminence)) : 0);
  const contrast = alternativeCount ? Math.max(...texts.slice(1 + sceneCount, 1 + sceneCount + alternativeCount).map(text => similarity(vBlend, text))) : null;
  const margin = contrast === null ? 0 : selected - contrast;
  const unwanted = cosine(vBlend, texts.at(-1));
  const bgClutter = hasMultiView && Array.isArray(wInv?.uBg) && wInv.uBg.length === vFull.length
    ? vFull.reduce((sum, val, i) => sum + (val - vCrop[i]) * wInv.uBg[i], 0) : 0;
  return { selected, contrast, margin, unwanted, cropProminence, bgClutter, cosine: scene,
    score: selected + (contrast === null ? 0 : 0.6 * margin) - 0.25 * Math.max(0, unwanted) - (hasMultiView ? 0.15 * Math.max(0, bgClutter) : 0) };
}
export function rankEmbeddedImages(items, model = null, { semanticFilter = false, fallbackLimit = 0 } = {}) {
  // Preference can reorder eligible photos, but cannot rescue a failed match.
  const eligible = semanticFilter ? items.filter(item => passesImageSemanticGate(item.semantic)) : items;
  if (semanticFilter && !eligible.length && fallbackLimit > 0) {
    return items.map((item, index) => ({ ...item, index, features: preferenceFeatures(item.vector, item.semantic),
      probability: .5, uncertain: true, belowThreshold: true, score: invariantRankingScore(model?.wInv, item.rankingEvidence) ?? item.semantic.score ?? item.semantic.cosine ?? item.semantic.selected }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.min(9, fallbackLimit));
  }
  const scored = eligible.map((item, index) => {
    const features = preferenceFeatures(item.vector, item.semantic);
    const encoded = encodeFullFeatures(features);
    const neural = isCurrentPersonalizer(model) && model.role !== 'semantic' && item.meaningFeatures;
    const invariantScore = invariantRankingScore(model?.wInv, item.rankingEvidence);
    const adjustment = neural ? personalizerScore(model, encoded, item.meaningFeatures) - personalizerScore(null, encoded, item.meaningFeatures) : 0;
    const probability = invariantScore ?? (neural ? 1 / (1 + Math.exp(-8 * adjustment)) : preferenceProbability(model, features));
    // Early feedback should have little influence. A visual preference must not
    // positively reward an image that matches another supplied sense better.
    const strength = 0.12 * Math.min(1, (model?.trainedLabels || 0) / 64);
    const preference = item.semantic.margin < 0 ? Math.min(0, probability - 0.5) : probability - 0.5;
    // Taste preferences are not match confidence. A new user's neutral .5
    // preference must not flag every otherwise clear semantic match.
    const uncertain = !passesImageSemanticGate(item.semantic)
      || (invariantScore !== null && Math.abs(invariantScore - 0.5) < 0.18)
      || (item.semantic.contrastSource !== 'dictionary' && item.semantic.contrast !== null && item.semantic.margin < IMAGE_SEMANTIC_FILTER.closeContrastMargin);
    return { ...item, index, features, probability, uncertain, score: invariantScore ?? (neural && !model.invariantOnly ? personalizerScore(model, encoded, item.meaningFeatures) : item.semantic.score + strength * preference) };
  });
  // Scores are shown in descending order; diversity penalties must not silently
  // reorder the list after a learned model has scored it.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  while (scored.length) {
    const candidate = scored.shift();
    if (!selected.some(item => cosine(item.vector, candidate.vector) > 0.97)) selected.push(candidate);
  }
  return selected;
}
async function awaitWarmupForTextEncoding(signal) {
  while (warmupPromise || activeInitializePromise) {
    signal?.throwIfAborted();
    const pendingInit = warmupPromise || activeInitializePromise;
    await new Promise((resolve, reject) => {
      const onAbort = () => reject(signal?.reason || new Error('Meaning text encoding was cancelled.'));
      signal?.addEventListener('abort', onAbort, { once: true });
      pendingInit.then(
        value => { signal?.removeEventListener('abort', onAbort); resolve(value); },
        error => { signal?.removeEventListener('abort', onAbort); reject(error); }
      );
    });
  }
}

// Reuses the installed text encoder and its IndexedDB vector cache independently
// of whether image suggestions are enabled. Never triggers a model download or
// mutates the user's device setting.
export async function encodeDefinitionTextsDetailed(texts, options = {}) {
  const record = detail => {
    textEncodingDetail = detail;
    options.onStatus?.(detail);
    return detail;
  };
  if (typeof Worker === 'undefined') {
    return record({ ...getMeaningTextEncodingStatus(options), ok: false, vectors: null });
  }
  if (options.signal?.aborted) {
    const reason = options.signal.reason?.message || 'Meaning text encoding was cancelled.';
    return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
  }
  const inputTexts = Array.isArray(texts) ? texts : [];
  const generation = featureGeneration;
  try {
    await awaitWarmupForTextEncoding(options.signal);
  } catch (error) {
    if (options.signal?.aborted) {
      const reason = error?.message || 'Meaning text encoding was cancelled.';
      return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
    }
    const status = generation !== featureGeneration ? 'cancelled' : 'error';
    const reason = error?.message || 'Local model initialization failed.';
    return record({ ...getMeaningTextEncodingStatus(options), ok: false, status, reason, message: reason, vectors: null });
  }
  if (options.signal?.aborted) {
    const reason = options.signal.reason?.message || 'Meaning text encoding was cancelled.';
    return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
  }
  const modelInstalled = await resolveInstalledTextModel(options);
  if (options.signal?.aborted) {
    const reason = options.signal.reason?.message || 'Meaning text encoding was cancelled.';
    return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
  }
  if (!modelInstalled) {
    if (!options.cacheStorage) installed = false;
    const base = getMeaningTextEncodingStatus(options);
    return record({ ...base, ok: false, available: false, status: 'not-installed', installed: false, ready: false, reason: base.message, vectors: null });
  }
  if (!inputTexts.length) {
    return record({ ...getMeaningTextEncodingStatus(options), ok: true, status: workerReady ? 'ready' : 'installed', reason: '', vectors: [] });
  }
  const vectors = [];
  try {
    for (let start = 0; start < inputTexts.length; start += 20) {
      options.signal?.throwIfAborted();
      if (generation !== featureGeneration) {
        const reason = 'The local image model was stopped.';
        return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
      }
      const batch = await rpc('texts', { texts: inputTexts.slice(start, start + 20) }, { ...options, allowMetered: false, cachedOnly: true });
      options.signal?.throwIfAborted();
      vectors.push(...batch);
    }
  } catch (error) {
    if (options.signal?.aborted) {
      const reason = error?.message || 'Meaning text encoding was cancelled.';
      return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
    }
    if (generation !== featureGeneration && /stopped/i.test(error?.message || '')) {
      const reason = error.message;
      return record({ ...getMeaningTextEncodingStatus(options), ok: false, status: 'cancelled', reason, message: reason, vectors: null });
    }
    const missing = /missing|not installed/i.test(error?.message || '');
    if (missing && !options.cacheStorage) installed = false;
    const reason = error?.message || 'Local meaning text encoding failed.';
    return record({
      ...getMeaningTextEncodingStatus(options),
      ok: false,
      available: !missing,
      status: missing ? 'not-installed' : 'error',
      installed: missing ? false : installed,
      ready: Boolean(worker && workerReady),
      reason,
      message: reason,
      vectors: null
    });
  }
  return record({ ...getMeaningTextEncodingStatus(options), ok: true, available: true, status: 'ready', installed: true, ready: true, reason: '', vectors });
}

export async function encodeDefinitionTexts(texts, options = {}) {
  options.signal?.throwIfAborted();
  const result = await encodeDefinitionTextsDetailed(texts, options);
  options.signal?.throwIfAborted();
  return result.ok ? result.vectors : null;
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
      try { await warmupPromise; } catch { return []; }
      if (!current() || !workerReady) return [];
    }
    const prompt = imageClipPrompts(word, options);
    // Start vision helpers now so they compile while the prompts are embedded.
    ensureVisionHelpers();
    const texts = await rpc('texts', { texts: prompt.texts }, inference);
    if (!current() || !workerReady) return [];
    // A picker opened before startup warmup creates the primary worker above.
    ensureVisionHelpers();
    const meaningFeatures = encodeMeaning(texts[0]);
    const meanVector = vectors => vectors.length ? normalizedVector(vectors.reduce((a, v) => a.map((x, i) => x + v[i]), Array(texts[0].length).fill(0))) : null;
    const sceneVector = meanVector(texts.slice(1, 1 + prompt.sceneCount)) || texts[0];
    const contrastVector = meanVector(texts.slice(1 + prompt.sceneCount, 1 + prompt.sceneCount + prompt.alternativeCount));
    const items = [];
    // Oversample in bounded worker batches; only screened photos reach the UI.
    const scoringLimit = Math.min(candidates.length, Math.max(4, Math.min(45,
      Number(options.localCandidateLimit) || IMAGE_SEMANTIC_FILTER.candidatePoolSize)));
    const requiredScenes = new Set(candidates.slice(0, scoringLimit).map(image => image.visualScene).filter(Boolean));
    const checkedScenes = new Set();
    // Each batch keeps every worker busy (two images per worker) while the
    // next batch of thumbnails downloads. A single-worker device keeps 4.
    const step = Math.max(IMAGE_THUMBNAIL_BATCH_LIMIT, 2 * (1 + helpers.length));
    const prepareBatch = start => {
      if (start >= scoringLimit) return null;
      const end = Math.min(start + step, scoringLimit);
      const groups = [];
      for (let offset = start; offset < end; offset += IMAGE_THUMBNAIL_BATCH_LIMIT) {
        groups.push(prepareImageThumbnails(candidates.slice(offset, Math.min(offset + IMAGE_THUMBNAIL_BATCH_LIMIT, end)), {
          ...options, limit: IMAGE_THUMBNAIL_BATCH_LIMIT, preferOriginal: true, timeoutMs: options.timeoutMs || 2800
        }));
      }
      return Promise.all(groups).then(results => results.flat());
    };
    let nextBatch = prepareBatch(0);
    for (let offset = 0; offset < scoringLimit; offset += step) {
      if (!current()) return [];
      const currentBatch = nextBatch;
      nextBatch = prepareBatch(offset + step);
      const thumbnails = await currentBatch;
      candidates.slice(offset, Math.min(offset + step, scoringLimit)).forEach(image => checkedScenes.add(image.visualScene));
      if (!current()) return [];
      // Dispatch the whole batch at once; results keep candidate order.
      const embeddedBatch = await Promise.all(thumbnails.map(thumbnail =>
        rpc('image', { blob: new Blob([base64ToBytes(thumbnail.inlineData.data)], { type: thumbnail.inlineData.mimeType }), multiView: true }, inference)
          .catch(err => { if (err?.backendFailure || !current()) throw err; return null; })));
      if (!current() || !workerReady) return [];
      thumbnails.forEach((thumbnail, index) => {
        const embedded = embeddedBatch[index];
        if (!embedded) return;
        const vector = Array.isArray(embedded) ? embedded : embedded.vector;
        const semantic = semanticScores(embedded, texts, prompt.sceneCount, prompt.alternativeCount);
        // Dictionary senses are not mutually exclusive visual contrasts:
        // e.g. "something resembling an apple" also embeds the actual fruit.
        // Retain their ranking penalty without treating it as calibrated doubt.
        semantic.contrastSource = prompt.contrastSource;
        const rankingEvidence = { encoder: CLIP_TAG, full: embedded.fullVector || vector, crop: embedded.cropVector || vector,
          baselineScore: semantic.score,
          meaning: texts[0], scene: sceneVector, contrast: contrastVector, unwanted: texts.at(-1) };
        items.push({ candidate: thumbnail.candidate, vector, meaningFeatures, rankingEvidence, semantic });
      });
      phase = 'scoring';message = `Scored ${items.length} of ${candidates.length} image suggestions locally.`;emit();
      // Fill a useful first gallery instead of always exhausting 45 candidates.
      // Search deeper when matches are scarce, duplicated, or a retrieval scene
      // has not been checked. Research can explicitly request the complete pool.
      if (!options.exhaustiveScoring && offset + step >= 12
        && [...requiredScenes].every(scene => checkedScenes.has(scene))
        && rankEmbeddedImages(items, null, { semanticFilter: true }).length >= 9) break;
    }
    const model = await training().current();
    if (!current() || !workerReady) return [];
    cachedModel = model;
    const scored = rankEmbeddedImages(items, model, { semanticFilter: true, fallbackLimit: 9 });
    phase = 'ready';message = items.length ? `${items.length} image suggestions scored locally.` : 'These images could not be checked. You can choose a photo manually.';emit();
    return [...scored.map(item => ({ ...item.candidate, ml: { model: CLIP_TAG, sense: fingerprint(word), features: encodeFullFeatures(item.features), meaningFeatures, preprocessing: IMAGE_PREPROCESSING, scenes: prompt.scenes,
      screening: 'scored', rankingEvidence: item.rankingEvidence, belowThreshold: Boolean(item.belowThreshold), uncertain: Boolean(item.uncertain), cosine: item.semantic.cosine, selected: item.semantic.selected, contrast: item.semantic.contrast, contrastSource: item.semantic.contrastSource, margin: item.semantic.margin, unwanted: item.semantic.unwanted, cropProminence: item.semantic.cropProminence ?? 0, preference: item.probability, trainedLabels: model?.trainedLabels || 0,
      trainedComparisons: model?.trainedComparisons || 0, trainedPositiveLabels: model?.trainedPositiveLabels || 0, trainedNegativeLabels: model?.trainedNegativeLabels || 0, score: item.score } }))];
  } catch (error) { if (current()) { phase = 'error';message = `${error.message} Image screening could not finish.`;emit(); } return []; }
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
export function recordImagePreference(word, action, image, { preferredImage, decisionId, feedbackReason } = {}) {
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
      ...(ml.rankingEvidence ? { rankingEvidence: ml.rankingEvidence } : {}), ...(feedbackReason === 'background' && action === 'wrong' ? { feedbackReason } : {}),
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
