import { bytesToBase64, base64ToBytes } from '../utils/base64.js';
import { sharedInferenceScope } from './sharedInferenceScope.js';

function nativeStorage() {
  if (globalThis.keepVocabDesktop?.modelStorage) return globalThis.keepVocabDesktop.modelStorage;
  const capacitor = globalThis.Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    const plugin = capacitor.Plugins?.ModelStorage || capacitor.registerPlugin?.('ModelStorage');
    if (plugin) return args => plugin.operate(args);
    throw new Error('Native model storage is unavailable.');
  }
  return null;
}
const urlOf = request => typeof request === 'string' ? request : request?.url;
async function digest(url) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function modelCacheStorage() {
  const invoke = nativeStorage();
  if (!invoke) return globalThis.caches;
  const browser = globalThis.caches;
  return {
    keys: async () => [...new Set([...(await invoke({ action: 'caches' })).names, ...(await browser?.keys() || []).filter(name => name.startsWith('keepvocab-clip-model') || name.startsWith('keepvocab-meaning-model'))])],
    delete: async cache => { await invoke({ action: 'drop', cache }); await browser?.delete(cache); return true; },
    open: async cache => {
      const legacy = await browser?.open(cache);
      const native = {
        has: async request => {
          const info = await invoke({ action: 'stat', cache, key: await digest(urlOf(request)) });
          return info.size > 0 || Boolean((await native.match(request))?.ok);
        },
        match: async request => {
          const url = urlOf(request);
          if (!/^https?:\/\//.test(url || '')) return undefined;
          const key = await digest(url), info = await invoke({ action: 'stat', cache, key });
          if (info.size > 0) {
            const chunks = [];
            for (let offset = 0; offset < info.size;) {
              const chunk = base64ToBytes((await invoke({ action: 'read', cache, key, offset })).data);
              if (!chunk.length || offset + chunk.length > info.size) throw new Error('Incomplete stored model.');
              chunks.push(chunk); offset += chunk.length;
            }
            return new Response(new Blob(chunks), { headers: info.headers });
          }
          // Move existing profile downloads into the app-owned folder once.
          const old = await legacy?.match(request);
          if (old) { await native.put(request, old.clone()); await legacy.delete(request); }
          return old;
        },
        put: async (request, response) => {
          const url = urlOf(request), key = await digest(url);
          const token = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
          const bytes = new Uint8Array(await response.arrayBuffer());
          try {
            for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) await invoke({ action: 'write', cache, key, token, offset, data: bytesToBase64(bytes.subarray(offset, offset + 1024 * 1024)) });
            await invoke({ action: 'commit', cache, key, token, size: bytes.length, url, headers: [...response.headers] });
          } catch (error) { await invoke({ action: 'abort', cache, key, token }).catch(() => {}); throw error; }
        },
        delete: async request => { await invoke({ action: 'delete', cache, key: await digest(urlOf(request)) }); await legacy?.delete(request); return true; },
        keys: async () => [...new Set([...(await invoke({ action: 'keys', cache })).urls, ...(await legacy?.keys() || []).map(urlOf)])]
      };
      return native;
    }
  };
}

// Workers use this proxy instead of writing browser profile model caches.
export function workerModelCache(cache) {
  const channel = typeof self.postMessage === 'function' ? self : sharedInferenceScope(self, cache === 'keepvocab-meaning-model-v1' ? 'meaning' : 'clip');
  let next = 0;
  const pending = new Map();
  channel.addEventListener('message', ({ data }) => {
    if (data.type !== 'model-cache-result' || data.cache !== cache) return;
    const item = pending.get(data.cacheId);
    if (!item) return;
    pending.delete(data.cacheId);
    data.error ? item.reject(new Error(data.error)) : item.resolve(data.result);
  });
  const call = (operation, payload) => new Promise((resolve, reject) => {
    const cacheId = ++next;
    pending.set(cacheId, { resolve, reject });
    channel.postMessage({ type: 'model-cache', cache, cacheId, operation, ...payload });
  });
  return {
    match: async request => {
      const data = await call('match', { url: urlOf(request) });
      return data ? new Response(data.bytes, { headers: data.headers }) : undefined;
    },
    put: async (request, response) => { await call('put', { url: urlOf(request), bytes: await response.arrayBuffer(), headers: [...response.headers] }); }
  };
}
export async function handleModelCacheRequest(worker, data) {
  if (data.type !== 'model-cache') return false;
  const reply = { type: 'model-cache-result', cache: data.cache, cacheId: data.cacheId,
    ...(data.sharedCacheToken !== undefined ? { sharedCacheToken: data.sharedCacheToken } : {}) };
  try {
    if (!['keepvocab-clip-model-v3', 'keepvocab-meaning-model-v1'].includes(data.cache)) throw new Error('Unknown model cache.');
    const cache = await modelCacheStorage()?.open(data.cache);
    if (!cache) throw new Error('Model storage is unavailable.');
    let result;
    if (data.operation === 'match') {
      const response = await cache.match(data.url);
      if (response) result = { bytes: await response.arrayBuffer(), headers: [...response.headers] };
    } else if (data.operation === 'put') await cache.put(data.url, new Response(data.bytes, { headers: data.headers }));
    else throw new Error('Unknown model cache operation.');
    worker.postMessage({ ...reply, result });
  } catch (error) { worker.postMessage({ ...reply, error: error.message }); }
  return true;
}
