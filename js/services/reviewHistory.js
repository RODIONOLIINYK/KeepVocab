// Full dated observations live in IndexedDB, separate from the small settings DB.
// A bounded fallback keeps practice usable on browsers that deny IndexedDB.
import { FSRS_CHANNELS, deserializeFsrsCard, serializeFsrsCard } from './fsrsConfig.js';
export const REVIEW_HISTORY_DB = 'keepvocab-review-history-v1';
export const MAX_REVIEW_EVENTS = 50000;
const FALLBACK_KEY = 'keepvocab_review_history_fallback_v1';
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const bounded = (value, max, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Number(value))) : fallback;
export function normalizeReviewEvent(input) {
  if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 200 || !input.wordId || !iso(input.occurredAt)
    || !FSRS_CHANNELS.includes(input.channel) || ![1, 2, 3, 4].includes(input.grade)) return null;
  const memory = input.memory || {};
  if (!memory.before || !memory.after) return null;
  if (![memory.before, memory.after].every(card => Number.isFinite(Date.parse(card.due)) && [0, 1, 2, 3].includes(card.state)
    && ['stability', 'difficulty', 'reps', 'lapses', 'scheduled_days', 'elapsed_days', 'learning_steps'].every(key => Number.isFinite(card[key]) && card[key] >= 0)
    && card.state === deserializeFsrsCard(card, new Date(input.occurredAt)).state)) return null;
  const context = Array.isArray(input.context) && input.context.length <= 40 && input.context.every(Number.isFinite) ? input.context.map(value => Math.max(-1, Math.min(1, value))) : [];
  return { version: 1, id: input.id, deviceId: String(input.deviceId || '').slice(0, 100), wordId: String(input.wordId).slice(0, 500), senseId: String(input.senseId || '').slice(0, 500),
    monthYear: String(input.monthYear || '').slice(0, 40), occurredAt: iso(input.occurredAt), channel: input.channel, grade: input.grade,
    exerciseType: String(input.exerciseType || '').slice(0, 100), recallType: String(input.recallType || '').slice(0, 40),
    correct: Boolean(input.correct), hintsUsed: bounded(input.hintsUsed, 100), producedUnaided: Boolean(input.producedUnaided),
    responseTimeMs: input.responseTimeMs == null ? null : bounded(input.responseTimeMs, 3600000),
    confidence: input.confidence == null ? null : bounded(input.confidence, 1), learnerRating: String(input.learnerRating || '').slice(0, 10),
    confusedWithWordId: String(input.confusedWithWordId || '').slice(0, 500),
    sessionId: String(input.sessionId || '').slice(0, 150), position: bounded(input.position, 10000),
    timezone: String(input.timezone || '').slice(0, 100), utcOffsetMinutes: Math.max(-840, Math.min(840, Number(input.utcOffsetMinutes) || 0)),
    context, memory: { before: serializeFsrsCard(deserializeFsrsCard(memory.before, new Date(input.occurredAt))),
      after: serializeFsrsCard(deserializeFsrsCard(memory.after, new Date(input.occurredAt))),
      revision: bounded(memory.revision, 1000000), retention: bounded(memory.retention, 1, 0.9), scheduled: memory.scheduled !== false } };
}
export function mergeReviewEvents(...groups) {
  const records = new Map();
  for (const input of groups.flat()) {
    const event = normalizeReviewEvent(input);
    if (!event) continue;
    const previous = records.get(event.id);
    if (!previous || JSON.stringify(event) > JSON.stringify(previous)) records.set(event.id, event);
  }
  return [...records.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)).slice(-MAX_REVIEW_EVENTS);
}
export class ReviewHistoryStore {
  constructor(storage, indexedDB = globalThis.indexedDB) {
    this.storage = storage;this.records = new Map();this.error = '';this.database = null;this.count = 0;
    this.ready = this.load(indexedDB);this.queue = this.ready;
  }
  async load(indexedDB) {
    let fallback = [];
    try { fallback = JSON.parse(this.storage?.getItem(FALLBACK_KEY) || '[]'); } catch { /* Ignore malformed fallback. */ }
    fallback = mergeReviewEvents(Array.isArray(fallback) ? fallback : []).slice(-1000);
    if (indexedDB) try {
      this.database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(REVIEW_HISTORY_DB, 2);
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains('events') ? request.transaction.objectStore('events') : database.createObjectStore('events', { keyPath: 'id' });
          if (!store.indexNames.contains('byTime')) store.createIndex('byTime', 'occurredAt');
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close();resolve(request.result); };
        request.onerror = () => reject(request.error);request.onblocked = () => reject(new Error('Review history is open in another app window.'));
      });
      if (fallback.length) await this.persist(fallback);
      this.storage?.removeItem(FALLBACK_KEY);
      // No getAll at startup: a long review history must not stay resident in RAM.
      return this;
    } catch { this.database = null;this.error = 'Review history is using limited fallback storage on this device.'; }
    this.records = new Map(fallback.map(event => [event.id, event]));this.count = this.records.size;
    return this;
  }
  async persist(events) {
    await new Promise((resolve, reject) => {
      const tx = this.database.transaction('events', 'readwrite');const store = tx.objectStore('events');
      for (const event of events) {
        const request = store.get(event.id);
        request.onsuccess = () => { if (!request.result || JSON.stringify(event) > JSON.stringify(request.result)) store.put(event); };
      }
      tx.oncomplete = resolve;tx.onerror = () => reject(tx.error);tx.onabort = () => reject(tx.error);
    });
    this.count = await new Promise((resolve, reject) => {
      const request = this.database.transaction('events').objectStore('events').count();
      request.onsuccess = () => resolve(request.result);request.onerror = () => reject(request.error);
    });
    if (this.count > MAX_REVIEW_EVENTS) await new Promise((resolve, reject) => {
      let remove = this.count - MAX_REVIEW_EVENTS;
      const tx = this.database.transaction('events', 'readwrite');
      const cursor = tx.objectStore('events').index('byTime').openCursor();
      cursor.onsuccess = () => { if (cursor.result && remove > 0) { cursor.result.delete();remove--;this.count--;cursor.result.continue(); } };
      tx.oncomplete = resolve;tx.onerror = () => reject(tx.error);tx.onabort = () => reject(tx.error);
    });
  }
  merge(events) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const incoming = mergeReviewEvents(Array.isArray(events) ? events : []);
      if (this.database) try { await this.persist(incoming);this.error = '';return { count: this.count }; }
      catch { this.error = 'Could not write full review history. New events are retained in fallback storage.'; }
      const merged = mergeReviewEvents([...this.records.values()], incoming);
      const combined = merged.slice(-1000);
      this.records = new Map(combined.map(event => [event.id, event]));
      if (!this.database) this.count = combined.length;
      try { this.storage?.setItem(FALLBACK_KEY, JSON.stringify(combined)); }
      catch { this.error = 'Review history storage is full. Your current word schedules are still saved.'; }
      if (!this.database && merged.length > 1000) this.error = 'Full history storage is unavailable; only the latest 1,000 events survive restart on this device.';
      return { count: this.count };
    });
    return this.queue;
  }
  append(event) { return this.merge([event]); }
  async all() {
    await this.queue;
    if (!this.database) return [...this.records.values()];
    const saved = await new Promise((resolve, reject) => {
      const request = this.database.transaction('events').objectStore('events').getAll();
      request.onsuccess = () => resolve(request.result);request.onerror = () => reject(new Error('Review history could not be read on this device.'));
    });
    return mergeReviewEvents(saved, [...this.records.values()]);
  }
}
