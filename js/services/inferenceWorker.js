import { APP_VERSION } from './version.js';
import { INFERENCE_CONTROL_CHANNEL } from './sharedInferenceScope.js';

const connections = new Set();
const generations = new Map();
const GENERATION_KEY = 'keepvocab_inference_generation_v1';
function sharedGeneration(kind) {
  try { return JSON.parse(globalThis.localStorage?.getItem(GENERATION_KEY) || '{}')?.[kind] || generations.get(kind) || '0'; }
  catch { return generations.get(kind) || '0'; }
}
globalThis.addEventListener?.('pagehide', () => {
  for (const connection of [...connections]) connection.terminate();
});

// The compiled model entry points support both dedicated and shared workers.
// Stable names give Main and Quick Add one loaded model per role, per version.
export function createInferenceWorker(kind, { role = 'full', slot = 0 } = {}) {
  if (!['clip', 'meaning'].includes(kind)) throw new Error('Unknown inference model.');
  const url = new URL(kind === 'clip' ? '../ml/clipWorker.bundle.js' : '../ml/meaningWorker.bundle.js', import.meta.url);
  if (typeof globalThis.SharedWorker === 'function') {
    let shared;
    try {
      shared = new SharedWorker(url, { type: 'module', name: `keepvocab-${APP_VERSION}-${kind}-${role}-${slot}-${sharedGeneration(kind)}` });
    } catch { /* Platforms without usable shared workers retain a dedicated worker. */ }
    if (shared) {
      let closed = false;
      const port = shared.port;
      const connection = {
        onmessage: null, onerror: null,
        postMessage(data) { if (!closed) port.postMessage(data); },
        terminate() {
          if (closed) return;
          closed = true; connections.delete(connection);
          try { port.postMessage({ type: 'inference-detach' }); } catch { /* Window is already closing. */ }
          port.close();
        }
      };
      const fail = error => {
        if (closed) return;
        connection.terminate(); connection.onerror?.({ message: error });
      };
      port.onmessage = ({ data }) => {
        if (closed) return;
        if (data?.type === 'inference-error') fail(data.error);
        else connection.onmessage?.({ data });
      };
      port.onmessageerror = () => fail('The shared model connection failed.');
      port.addEventListener('close', () => fail('The shared model connection closed.'));
      shared.onerror = event => { event.preventDefault?.(); fail(event.message || 'The shared model could not start.'); };
      port.start(); connections.add(connection);
      return connection;
    }
  }
  return new Worker(url, { type: 'module' });
}

// Explicit settings actions invalidate loaded copies in every app window.
// Normal cancellation/closing only releases the caller's own connection.
export function resetInferenceWorkers(kind) {
  if (typeof globalThis.SharedWorker !== 'function' || typeof globalThis.BroadcastChannel !== 'function') return;
  // A quick re-enable must not attach to a model still processing its reset.
  // Keep only the current generation per kind, shared with the other window.
  const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  generations.set(kind, generation);
  try {
    const current = JSON.parse(globalThis.localStorage?.getItem(GENERATION_KEY) || '{}');
    globalThis.localStorage?.setItem(GENERATION_KEY, JSON.stringify({ ...current, [kind]: generation }));
  } catch { /* Local inference still works when storage is unavailable. */ }
  const channel = new BroadcastChannel(INFERENCE_CONTROL_CHANNEL);
  channel.postMessage({ type: 'reset', kind }); channel.close();
}
