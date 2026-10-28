import { CLIP_TAG, LEGACY_CLIP_TAG } from '../ml/clipConfig.js';
import { decodeFeatures, COMPARISON_RECORD_MODEL } from './imagePreferences.js';

export const IMAGE_HISTORY_DB = 'keepvocab-image-history-v2';
export const IMAGE_HISTORY_CHUNK = 100;
const PREFIX = 'keepvocab_image_history_v2';
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const timestamp = value => Date.parse(value || '') || 0;
const cleanUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href.slice(0, 3000) : ''; } catch { return ''; } };
export function normalizeImageEvent(input) {
  if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 3000 || !iso(input.updatedAt) || ![0, 1].includes(input.label)) return null;
  try { decodeFeatures(input.features); if (input.kind === 'comparison') decodeFeatures(input.preferredFeatures); if (input.meaningFeatures) decodeFeatures(input.meaningFeatures); } catch { return null; }
  const encoder = input.encoder || input.model?.replace(/:pairwise-v1$/, '') || LEGACY_CLIP_TAG;
  if (input.model && input.model.replace(/:pairwise-v1$/, '') !== encoder) return null;
  if (![CLIP_TAG, LEGACY_CLIP_TAG].includes(encoder) || input.model && ![CLIP_TAG, LEGACY_CLIP_TAG, COMPARISON_RECORD_MODEL, `${LEGACY_CLIP_TAG}:pairwise-v1`].includes(input.model) || input.kind && input.kind !== 'comparison') return null;
  return { version: 2, task: input.task === 'semantic' ? 'semantic' : 'preference', id: input.id, key: String(input.key || input.id).slice(0, 3000), deviceId: String(input.deviceId || '').slice(0, 150),
    decisionId: String(input.decisionId || input.id).slice(0, 3000), meaningId: String(input.meaningId || '').slice(0, 1000), updatedAt: iso(input.updatedAt),
    label: input.label, features: input.features, ...(input.kind === 'comparison' ? { kind: 'comparison', preferredFeatures: input.preferredFeatures } : {}),
    ...(input.meaningFeatures ? { meaningFeatures: input.meaningFeatures } : {}), encoder,
    preprocessing: String(input.preprocessing || 'legacy-center-crop').slice(0, 100),
    context: { word: String(input.context?.word || '').slice(0, 160), definition: String(input.context?.definition || '').slice(0, 2000),
      scenes: (Array.isArray(input.context?.scenes) ? input.context.scenes : []).slice(0, 8).map(s => String(s).slice(0, 500)),
      imageUrl: cleanUrl(input.context?.imageUrl), sourceUrl: cleanUrl(input.context?.sourceUrl), preferredUrl: cleanUrl(input.context?.preferredUrl) },
    ...(Array.isArray(input.predictions) ? { predictions: input.predictions.slice(0, 4).map(p => ({ revision: Math.max(0, Number(p.revision) || 0), chosenScore: Number(p.chosenScore) || 0, alternativeScore: Number(p.alternativeScore) || 0 })) } : {}) };
}
export function mergeImageEvents(...groups) {
  const records = new Map();
  for (const input of groups.flat()) {
    const record = normalizeImageEvent(input); if (!record) continue;
    const previous = records.get(record.id);
    if (!previous || JSON.stringify(record) > JSON.stringify(previous)) records.set(record.id, record);
  }
  // This is an archive, not a replay buffer. No slice or retention cap.
  return [...records.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
}
export class ImageLearningHistoryStore {
  constructor(storage, indexedDB = globalThis.indexedDB) {
    this.storage = storage; this.database = null; this.records = new Map(); this.resetAt = ''; this.error = ''; this.count = 0; this.summary = {};
    this.ready = this.load(indexedDB); this.queue = this.ready;
  }
  async load(indexedDB) {
    let fallback = [];
    try {
      const manifest = JSON.parse(this.storage?.getItem(PREFIX) || '{}'); this.resetAt = iso(manifest.resetAt) || '';
      const reset = JSON.parse(this.storage?.getItem(`${PREFIX}_resetAt`) || 'null');
      if (timestamp(reset) > timestamp(this.resetAt)) this.resetAt = iso(reset);
      for (const key of manifest.chunks || []) fallback.push(...JSON.parse(this.storage.getItem(key) || '[]'));
    } catch { this.error = 'Some saved photo choices could not be read.'; }
    if (indexedDB) try {
      this.database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(IMAGE_HISTORY_DB, 1);
        request.onupgradeneeded = () => {
          const events = request.result.createObjectStore('events', { keyPath: 'id' }); events.createIndex('byKey', 'key'); events.createIndex('byLabel', 'label'); events.createIndex('byKind', 'kind');
          request.result.createObjectStore('state');
        };
        request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
        request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Photo history is busy.'));
      });
      const state = await this.readState('resetAt'); if (timestamp(state) > timestamp(this.resetAt)) this.resetAt = state;
      if (fallback.length) await this.persist(mergeImageEvents(fallback).filter(r => timestamp(r.updatedAt) > timestamp(this.resetAt)));
      await this.writeState('resetAt', this.resetAt); await this.refreshCount(); return this;
    } catch { this.database = null; }
    this.records = new Map(mergeImageEvents(fallback).filter(r => timestamp(r.updatedAt) > timestamp(this.resetAt)).map(r => [r.id, r]));
    await this.refreshCount(); return this;
  }
  async readState(key) {
    if (!this.database) { try { return JSON.parse(this.storage?.getItem(`${PREFIX}_${key}`) || 'null'); } catch { return null; } }
    return new Promise((resolve, reject) => { const r = this.database.transaction('state').objectStore('state').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  }
  async writeState(key, value) {
    if (!this.database) { this.storage?.setItem(`${PREFIX}_${key}`, JSON.stringify(value, (_key, item) => ArrayBuffer.isView(item) ? Array.from(item) : item)); return; }
    await new Promise((resolve, reject) => { const tx = this.database.transaction('state', 'readwrite'); tx.objectStore('state').put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }
  async refreshCount() {
    if (!this.database) {
      this.count = this.records.size; const rows = [...this.records.values()];
      this.summary = { positive: rows.filter(r => r.label === 1).length, negative: rows.filter(r => r.label === 0 && r.kind !== 'comparison').length, comparisons: rows.filter(r => r.kind === 'comparison').length }; return;
    }
    this.count = await new Promise((resolve, reject) => { const r = this.database.transaction('events').objectStore('events').count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const count = (index, key) => new Promise((resolve, reject) => { const r = this.database.transaction('events').objectStore('events').index(index).count(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const [positive, comparisons] = await Promise.all([count('byLabel', 1), count('byKind', 'comparison')]);
    this.summary = { positive, comparisons, negative: this.count - positive - comparisons };
  }
  async persist(events) {
    await new Promise((resolve, reject) => {
      const tx = this.database.transaction('events', 'readwrite'), store = tx.objectStore('events');
      for (const event of events) { const r = store.get(event.id); r.onsuccess = () => { if (!r.result || JSON.stringify(event) > JSON.stringify(r.result)) store.put(event); }; }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  fallbackSave(records) {
    const previous = JSON.parse(this.storage?.getItem(PREFIX) || '{}'), generation = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const chunks = [];
    try {
      for (let i = 0; i < records.length; i += IMAGE_HISTORY_CHUNK) { const key = `${PREFIX}_${generation}_${i}`; this.storage?.setItem(key, JSON.stringify(records.slice(i, i + IMAGE_HISTORY_CHUNK))); chunks.push(key); }
      this.storage?.setItem(PREFIX, JSON.stringify({ resetAt: this.resetAt, chunks }));
    } catch (error) { for (const key of chunks) this.storage?.removeItem(key); throw error; }
    for (const key of previous.chunks || []) this.storage?.removeItem(key);
  }
  merge(events, resetAt = '') {
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (timestamp(resetAt) > timestamp(this.resetAt)) {
        this.resetAt = iso(resetAt); await this.writeState('resetAt', this.resetAt);
        if (this.database) await new Promise((resolve, reject) => { const tx = this.database.transaction('events', 'readwrite'), r = tx.objectStore('events').openCursor(); r.onsuccess = () => { if (!r.result) return; if (timestamp(r.result.value.updatedAt) <= timestamp(this.resetAt)) r.result.delete(); r.result.continue(); }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      }
      const incoming = mergeImageEvents(events).filter(r => timestamp(r.updatedAt) > timestamp(this.resetAt));
      if (this.database) await this.persist(incoming);
      else {
        const records = mergeImageEvents([...this.records.values()], incoming).filter(r => timestamp(r.updatedAt) > timestamp(this.resetAt));
        // Commit fallback files before acknowledging persistence; quota errors never prune old history.
        this.fallbackSave(records); this.records = new Map(records.map(r => [r.id, r]));
      }
      await this.refreshCount(); this.error = ''; return { count: this.count, resetAt: this.resetAt };
    }).catch(error => { this.error = 'Could not save photo preferences. Free some device storage and try again.'; throw error; });
    return this.queue;
  }
  append(event) { return this.merge([event]); }
  async all() {
    await this.queue.catch(() => {});
    if (!this.database) return [...this.records.values()].filter(r => timestamp(r.updatedAt) > timestamp(this.resetAt));
    return new Promise((resolve, reject) => { const r = this.database.transaction('events').objectStore('events').getAll(); r.onsuccess = () => resolve(mergeImageEvents(r.result).filter(e => timestamp(e.updatedAt) > timestamp(this.resetAt))); r.onerror = () => reject(r.error); });
  }
  async latest(key) {
    await this.queue.catch(() => {});
    const rows = this.database ? await new Promise((resolve, reject) => { const r = this.database.transaction('events').objectStore('events').index('byKey').getAll(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }) : [...this.records.values()].filter(r => r.key === key);
    return rows.filter(r => timestamp(r.updatedAt) > timestamp(this.resetAt)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id)).at(-1);
  }
  async model() { await this.ready; return this.readState('activeModel'); }
  async saveModel(model) { await this.ready; await this.writeState('activeModel', model); }
}
