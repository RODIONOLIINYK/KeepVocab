import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { bytesToBase64, base64ToBytes } from '../utils/base64.js';

export const PREFERENCE_DIMENSION = CLIP_DIMENSION + 3;
export const MIN_LABELS = 8;
export const TRAIN_BATCH = 4;
export const MAX_LABELS = 256;
export const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const time = value => Date.parse(value || '') || 0;
export function normalizedVector(values, dimension = CLIP_DIMENSION) {
  if (!values || values.length !== dimension || !Array.from(values).every(Number.isFinite)) throw new Error('Invalid embedding vector.');
  const norm = Math.hypot(...values);
  if (norm < 1e-8) throw new Error('Empty embedding vector.');
  return Array.from(values, value => value / norm);
}
export function cosine(a, b) {
  if (a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) throw new Error('Invalid embedding dimensions.');
  return Math.max(-1, Math.min(1, a.reduce((sum, value, index) => sum + value * b[index], 0)));
}
export function preferenceFeatures(vector, semantic) {
  return [...normalizedVector(vector), ...[semantic.selected, semantic.margin, semantic.unwanted].map(value => Math.max(-1, Math.min(1, Number(value) || 0)))];
}
export function encodeFeatures(features) {
  if (features.length !== PREFERENCE_DIMENSION || !features.every(Number.isFinite)) throw new Error('Invalid preference features.');
  return bytesToBase64(Uint8Array.from(features, value => Math.round(Math.max(-1, Math.min(1, value)) * 127) & 255));
}
export function decodeFeatures(encoded) {
  if (typeof encoded !== 'string' || encoded.length !== 688 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid preference record.');
  const bytes = base64ToBytes(encoded);
  if (bytes.length !== PREFERENCE_DIMENSION) throw new Error('Invalid preference record.');
  return Array.from(bytes, value => (value > 127 ? value - 256 : value) / 127);
}
export function parameterFingerprint(weights) {
  let hash = 2166136261;
  for (const char of weights.map(value => Number(value).toFixed(9)).join(',')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function mergeImageLearning(left = {}, right = {}) {
  left = left && typeof left === 'object' ? left : {};
  right = right && typeof right === 'object' ? right : {};
  const resetAt = time(left.resetAt) >= time(right.resetAt) ? left.resetAt || '' : right.resetAt || '';
  const records = new Map();
  for (const item of [...(Array.isArray(left.records) ? left.records : []), ...(Array.isArray(right.records) ? right.records : [])]) {
    if (!item || typeof item.id !== 'string' || item.id.length > 3000 || item.model !== CLIP_TAG || ![0, 1].includes(item.label)
      || time(item.updatedAt) <= time(resetAt) || !time(item.updatedAt)) continue;
    try { decodeFeatures(item.features); } catch { continue; }
    const clean = { id: item.id, model: CLIP_TAG, label: item.label, features: item.features, updatedAt: item.updatedAt };
    const previous = records.get(clean.id);
    // A stable tie-break makes concurrent edits converge on both devices.
    if (!previous || time(clean.updatedAt) > time(previous.updatedAt)
      || (time(clean.updatedAt) === time(previous.updatedAt) && JSON.stringify(clean) > JSON.stringify(previous))) records.set(clean.id, clean);
  }
  return { version: 1, resetAt, records: [...records.values()].sort((a, b) => time(a.updatedAt) - time(b.updatedAt) || a.id.localeCompare(b.id)).slice(-MAX_LABELS) };
}
export function fitPreferences(records, previous = null) {
  const examples = records.map(record => ({ x: decodeFeatures(record.features), y: record.label }));
  const positives = examples.filter(item => item.y).length;
  const negatives = examples.length - positives;
  if (examples.length < MIN_LABELS || positives < 2 || negatives < 2) return null;
  const weights = Array(PREFERENCE_DIMENSION + 1).fill(0);
  // Refit a bounded, balanced replay set instead of repeatedly fitting the last click.
  for (let epoch = 0; epoch < 40; epoch++) {
    const gradient = weights.map((value, index) => value * (index === PREFERENCE_DIMENSION ? 0.05 : 0.2));
    for (const { x, y } of examples) {
      const z = weights[PREFERENCE_DIMENSION] + x.reduce((sum, value, index) => sum + value * weights[index], 0);
      const error = (sigmoid(z) - y) * 0.5 / (y ? positives : negatives);
      for (let index = 0; index < x.length; index++) gradient[index] += error * x[index];
      gradient[PREFERENCE_DIMENSION] += error;
    }
    for (let index = 0; index < weights.length; index++) weights[index] -= 0.4 * gradient[index];
  }
  const before = previous?.weights?.length === weights.length ? previous.weights : weights.map(() => 0);
  const deltaL2 = Math.hypot(...weights.map((value, index) => value - before[index]));
  return { model: CLIP_TAG, weights, revision: (Number(previous?.revision) || 0) + 1, trainedLabels: records.length,
    trainedRecordIds: records.map(record => `${record.id}|${record.updatedAt}|${record.label}|${record.features}`),
    fingerprint: parameterFingerprint(weights), beforeFingerprint: parameterFingerprint(before), deltaL2,
    changedParameters: weights.filter((value, index) => Math.abs(value - before[index]) > 1e-9).length,
    updatedAt: new Date().toISOString() };
}
export function updatePreferenceModel(data, previous = null) {
  const records = mergeImageLearning(data).records;
  const trained = new Set(previous?.trainedRecordIds || []);
  const queued = records.filter(record => !trained.has(`${record.id}|${record.updatedAt}|${record.label}|${record.features}`)).length;
  const removed = (previous?.trainedRecordIds || []).some(key => !records.some(record => key === `${record.id}|${record.updatedAt}|${record.label}|${record.features}`));
  if (previous && !removed && queued < TRAIN_BATCH) return { model: previous, queued, trained: false };
  const model = fitPreferences(records, previous);
  return { model, queued: model ? 0 : queued, trained: Boolean(model) };
}
export function preferenceProbability(model, features) {
  if (!model || model.model !== CLIP_TAG || model.weights?.length !== features.length + 1 || !model.weights.every(Number.isFinite)) return 0.5;
  return sigmoid(features.reduce((sum, value, index) => sum + value * model.weights[index], model.weights.at(-1)));
}
