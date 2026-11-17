import { APP_VERSION } from './version.js';

export const INFERENCE_CONTROL_CHANNEL = `keepvocab-inference-control-${APP_VERSION}-v1`;
const scopes = new WeakMap();

// Adapt a SharedWorker's ports to the message interface used by the existing
// inference queues and model-storage proxy. Results are never broadcast.
export function sharedInferenceScope(scope, kind) {
  if (scopes.has(scope)) return scopes.get(scope);
  const ports = new Map(), requests = new Map(), cacheRequests = new Map(), listeners = new Set();
  let nextId = 0, nextCacheId = 0, closed = false, lastStatus, closeTimer;
  const control = scope.BroadcastChannel ? new scope.BroadcastChannel(INFERENCE_CONTROL_CHANNEL) : null;
  const channel = {
    onmessage: null,
    addEventListener(type, listener) { if (type === 'message') listeners.add(listener); },
    postMessage(data) {
      if (closed) return;
      if (data.type === 'model-cache') { routeCache(data); return; }
      if (data.type === 'status') {
        lastStatus = data;
        for (const port of [...ports.keys()]) if (!send(port, data)) detach(port);
        return;
      }
      const request = requests.get(data.id);
      if (!request) return; // Cancelled or disconnected callers receive no result.
      requests.delete(data.id); ports.get(request.port)?.delete(request.id);
      if (!send(request.port, { ...data, id: request.id })) detach(request.port);
    }
  };
  const dispatch = data => {
    for (const listener of listeners) listener({ data });
    channel.onmessage?.({ data });
  };
  function send(port, data) {
    try { port.postMessage(data); return true; } catch { return false; }
  }
  function close(reason) {
    if (closed) return;
    closed = true;
    clearTimeout(closeTimer);
    for (const route of cacheRequests.values()) clearTimeout(route.timer);
    cacheRequests.clear(); requests.clear();
    for (const port of ports.keys()) {
      if (reason) send(port, { type: 'inference-error', error: reason });
      port.close();
    }
    ports.clear(); listeners.clear(); control?.close(); scope.close();
  }
  function detach(port) {
    const owned = ports.get(port);
    if (!owned) return;
    ports.delete(port);
    for (const id of owned.values()) {
      requests.delete(id);
      dispatch({ type: 'cancel', id });
    }
    port.close();
    if (!ports.size) {
      // A foreground service may release and reconnect during recovery. Let
      // pending connection events arrive before retiring the final model copy.
      closeTimer = setTimeout(() => { if (!ports.size) close(); }, 100);
      return;
    }
    // Native cache I/O is served by a window's preload bridge. If that window
    // closes during loading, continue through another attached window.
    for (const route of cacheRequests.values()) if (route.port === port) sendCache(route);
  }
  function sendCache(route) {
    clearTimeout(route.timer);
    if (closed || !cacheRequests.has(route.token)) return;
    const port = [...ports.keys()].find(item => !route.tried.has(item));
    if (!port) {
      cacheRequests.delete(route.token);
      dispatch({ type: 'model-cache-result', cache: route.data.cache, cacheId: route.data.cacheId,
        error: 'The model storage connection was closed or timed out.' });
      return;
    }
    route.port = port; route.tried.add(port);
    if (!send(port, { ...route.data, sharedCacheToken: route.token })) {
      route.port = null; detach(port); sendCache(route); return;
    }
    route.timer = setTimeout(() => sendCache(route), 90_000);
    route.timer.unref?.();
  }
  function routeCache(data) {
    const route = { token: ++nextCacheId, data, port: null, tried: new Set(), timer: null };
    cacheRequests.set(route.token, route); sendCache(route);
  }
  scope.onconnect = ({ ports: connected }) => {
    for (const port of connected) {
      if (closed) { send(port, { type: 'inference-error', error: 'The shared model was stopped.' }); port.close(); continue; }
      clearTimeout(closeTimer);
      const owned = new Map(); ports.set(port, owned);
      port.addEventListener('message', ({ data }) => {
        if (closed || !ports.has(port) || !data) return;
        if (data.type === 'inference-detach') { detach(port); return; }
        if (data.type === 'model-cache-result') {
          const route = cacheRequests.get(data.sharedCacheToken);
          if (!route || route.port !== port || route.data.cache !== data.cache || route.data.cacheId !== data.cacheId) return;
          clearTimeout(route.timer); cacheRequests.delete(route.token);
          dispatch(data); return;
        }
        if (data.type === 'cancel') {
          const id = owned.get(data.id);
          if (id === undefined) return;
          owned.delete(data.id); requests.delete(id); dispatch({ ...data, id }); return;
        }
        if (!Number.isSafeInteger(data.id) || owned.has(data.id)) return;
        const id = ++nextId;
        owned.set(data.id, id); requests.set(id, { port, id: data.id });
        dispatch({ ...data, id });
      });
      port.addEventListener('messageerror', () => detach(port));
      port.addEventListener('close', () => detach(port));
      port.start();
      if (lastStatus && !send(port, lastStatus)) detach(port);
    }
  };
  if (control) control.onmessage = ({ data }) => {
    if (data?.type === 'reset' && data.kind === kind) close('The shared model was disabled or removed.');
  };
  scopes.set(scope, channel);
  return channel;
}
