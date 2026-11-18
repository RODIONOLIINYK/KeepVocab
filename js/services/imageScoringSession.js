import { createImageThumbnailCache } from './imageThumbnails.js';

// One addition/review owns this cache. Store only raw vision outputs: meaning
// scores and preference decisions must always be recomputed for each meaning.
const MAX_ENTRIES = 96;
export function createImageScoringSession() {
  const entries = new Map();
  const thumbnailCache = createImageThumbnailCache();
  let closed = false;
  let serial = Promise.resolve(), sequence = 0;
  const jobs = new Map();
  const stopJobs = () => { for (const job of jobs.values()) { job.controller.abort(); job.listeners.clear(); } jobs.clear(); };
  return {
    get size() { return entries.size; },
    get closed() { return closed; },
    thumbnailCache,
    clear() { closed = true; stopJobs(); thumbnailCache.clear(); entries.clear(); },
    stopJobs,
    defer(run) {
      if (closed) throw new Error('Image scoring session has ended.');
      const key = `image-job-${++sequence}`;
      const controller = new AbortController();
      jobs.set(key, { controller, listeners: new Set(), run, started: false });
      return { key, signal: controller.signal };
    },
    subscribe(key, listener) {
      const job = jobs.get(key);
      if (!job || closed || job.controller.signal.aborted) return () => {};
      job.listeners.add(listener);
      if (!job.started) {
        job.started = true;
        serial = serial.catch(() => {}).then(async () => {
          if (closed || job.controller.signal.aborted) return;
          const publish = value => { if (!closed && !job.controller.signal.aborted) for (const callback of job.listeners) callback(value); };
          try { await job.run(publish); } finally { jobs.delete(key); job.listeners.clear(); }
        }).catch(() => {});
      }
      return () => { job.listeners.delete(listener); if (!job.listeners.size) { job.controller.abort(); jobs.delete(key); } };
    },
    async embed(blob, namespace, compute) {
      if (closed) throw new Error('Image scoring session has ended.');
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      if (closed) throw new Error('Image scoring session has ended.');
      const key = `${namespace}:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
      let pending = entries.get(key);
      if (!pending) {
        pending = Promise.resolve().then(() => {
          if (closed) throw new Error('Image scoring session has ended.');
          return compute();
        }).catch(error => { if (entries.get(key) === pending) entries.delete(key); throw error; });
        entries.set(key, pending);
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
      }
      const result = await pending;
      if (closed) throw new Error('Image scoring session has ended.');
      return result;
    }
  };
}
