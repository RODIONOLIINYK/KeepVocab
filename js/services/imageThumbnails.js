import { bytesToBase64 } from '../utils/base64.js?v=18800';

const MAX_DIMENSION = 384;
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_THUMBNAIL_BYTES = 128_000;
const MAX_SOURCE_PIXELS = 24_000_000;
const CACHE_LIMIT = 32;
const CACHE_BYTES = 2_000_000;
const cache = new Map();
const inFlight = new Map();
const functionIds = new WeakMap();
let nextFunctionId = 0;
let cachedBytes = 0;

function bounded(value, fallback, maximum) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? fallback : Math.max(0, Math.min(maximum, Math.floor(number)));
}

function mimeType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/webp'].includes(type) ? type : '';
}

function imageUrl(image) {
  for (const value of [image?.thumbnailUrl, image?.url]) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* Invalid or local URLs are not fetched for optional vision. */ }
  }
  return '';
}

function abortError() {
  const error = new Error('Image thumbnail preparation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function decodeInBrowser(blob, { signal }) {
  if (typeof globalThis.createImageBitmap === 'function') return globalThis.createImageBitmap(blob);
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) throw new Error('Image decoding is unavailable.');
  const image = document.createElement('img');
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      const abort = () => { image.src = ''; reject(abortError()); };
      const finish = callback => () => { signal.removeEventListener('abort', abort); callback(); };
      image.onload = finish(resolve);
      image.onerror = finish(() => reject(new Error('The image could not be decoded.')));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight, source: image, close: () => { image.src = ''; } };
  } finally {
    image.onload = null;
    image.onerror = null;
    URL.revokeObjectURL(url);
  }
}

async function resizeInBrowser(image, { width, height, quality }) {
  const canvas = typeof globalThis.OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height) : globalThis.document?.createElement('canvas');
  if (!canvas) throw new Error('Image resizing is unavailable.');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Image resizing is unavailable.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image.source || image, 0, 0, width, height);
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), 'image/jpeg', quality));
}

async function decodeChecked(blob, config, signal) {
  const pending = Promise.resolve().then(() => config.decode(blob, { signal }));
  // A browser decoder may finish after cancellation; release that late bitmap too.
  pending.then(image => { if (signal.aborted) image?.close?.(); }, () => {});
  const image = await abortable(pending, signal);
  const { width, height } = image || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || width > 16_384 || height > 16_384 || width * height > MAX_SOURCE_PIXELS) {
    image?.close?.();
    throw new Error('Invalid image dimensions.');
  }
  return image;
}

async function download(url, config, signal) {
  const response = await abortable(config.fetchImpl.call(globalThis, url, {
    signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'image/jpeg,image/png,image/webp' }
  }), signal);
  const type = mimeType(response.headers?.get?.('content-type'));
  const length = Number(response.headers?.get?.('content-length'));
  if (!response.ok || !type || length > config.maxSourceBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('Unsupported or oversized image response.');
  }
  if (!response.body?.getReader) {
    const blob = await abortable(response.blob(), signal);
    if (!blob.size || blob.size > config.maxSourceBytes) throw new Error('Oversized image response.');
    return new Blob([blob], { type });
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > config.maxSourceBytes) throw new Error('Oversized image response.');
      chunks.push(value);
    }
    if (!size) throw new Error('Empty image response.');
    return new Blob(chunks, { type });
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

async function prepare(url, config, signal) {
  const source = await download(url, config, signal);
  const decoded = await decodeChecked(source, config, signal);
  try {
    const scale = Math.min(1, config.maxDimension / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    let blob = source;
    if (scale < 1 || source.size > config.maxBytes) {
      blob = await abortable(config.resize(decoded, { width, height, quality: 0.76, signal }), signal);
      if (!mimeType(blob?.type) || !blob.size || blob.size > config.maxBytes) return null;
      const resized = await decodeChecked(blob, config, signal);
      try {
        if (resized.width !== width || resized.height !== height) return null;
      } finally { resized.close?.(); }
    }
    if (signal.aborted || !blob.size || blob.size > config.maxBytes) return null;
    const bytes = await abortable(blob.arrayBuffer(), signal);
    return { inlineData: { mimeType: mimeType(blob.type), data: bytesToBase64(bytes) }, width, height, byteLength: blob.size };
  } finally { decoded.close?.(); }
}

function functionId(fn) {
  if (!functionIds.has(fn)) functionIds.set(fn, ++nextFunctionId);
  return functionIds.get(fn);
}

function forget(key) {
  const entry = cache.get(key);
  if (entry) cachedBytes -= entry.cost;
  cache.delete(key);
}

function remember(key, value) {
  forget(key);
  const cost = value ? value.inlineData.data.length * 2 + 128 : 64;
  cache.set(key, { value, cost, expires: Date.now() + (value ? 15 * 60_000 : 30_000) });
  cachedBytes += cost;
  while (cache.size > CACHE_LIMIT || cachedBytes > CACHE_BYTES) forget(cache.keys().next().value);
}

async function sharedThumbnail(url, config, signal) {
  const key = JSON.stringify([url, config.maxDimension, config.maxBytes, config.maxSourceBytes, config.timeoutMs,
    functionId(config.fetchImpl), functionId(config.decode), functionId(config.resize)]);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }
  if (cached) forget(key);
  let pending = inFlight.get(key);
  if (!pending) {
    const controller = new AbortController();
    pending = { controller, users: 0, settled: false };
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    pending.promise = prepare(url, config, controller.signal).catch(() => null).then(value => {
      if (!controller.signal.aborted) remember(key, value);
      return value;
    }).finally(() => {
      clearTimeout(timer);
      pending.settled = true;
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
  }
  pending.users += 1;
  try { return await abortable(pending.promise, signal); }
  finally {
    pending.users -= 1;
    if (!pending.users && !pending.settled) {
      pending.controller.abort();
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  }
}

/**
 * Prepare at most four optional vision cues using browser CORS fetch and canvas.
 * Each result's candidateId/index maps to the original input index, including when
 * earlier candidates fail. decode(blob,{signal}) and resize(decoded,{width,height,
 * quality,signal}) are injectable; resized bytes are decoded again to verify size.
 * Failures return fewer cues so callers can retain their lexical ranking.
 */
export async function prepareImageThumbnails(images, options = {}) {
  const limit = bounded(options.limit, 4, 4);
  const config = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    decode: options.decode || decodeInBrowser,
    resize: options.resize || resizeInBrowser,
    maxDimension: bounded(options.maxDimension, MAX_DIMENSION, MAX_DIMENSION),
    maxSourceBytes: bounded(options.maxSourceBytes, MAX_SOURCE_BYTES, MAX_SOURCE_BYTES),
    maxBytes: bounded(options.maxBytes, MAX_THUMBNAIL_BYTES, MAX_THUMBNAIL_BYTES),
    timeoutMs: Math.max(1, bounded(options.timeoutMs, 5_000, 10_000))
  };
  if (!Array.isArray(images) || !limit || !config.fetchImpl || !config.maxDimension || !config.maxBytes || !config.maxSourceBytes || options.signal?.aborted) return [];
  const signal = options.signal || new AbortController().signal;
  const results = new Array(Math.min(images.length, limit));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, results.length) }, async () => {
    while (next < results.length && !signal.aborted) {
      const index = next++;
      const candidate = images[index];
      const url = imageUrl(candidate);
      if (!url) continue;
      try {
        const value = await sharedThumbnail(url, config, signal);
        if (value && !signal.aborted) results[index] = { ...value, inlineData: { ...value.inlineData }, candidateId: index, index, candidate };
      } catch { /* Optional vision never prevents metadata-only image picking. */ }
    }
  }));
  return results.filter(Boolean);
}
