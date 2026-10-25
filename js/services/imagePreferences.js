import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { bytesToBase64, base64ToBytes } from '../utils/base64.js';

export const PREFERENCE_DIMENSION = CLIP_DIMENSION + 3;
export const MIN_LABELS = 8;
export const TRAIN_BATCH = 4;
export const MAX_LABELS = 256;
// Older clients accept only CLIP_TAG records and would strip comparison fields,
// turning a relative loser into an explicit rejection. A separate record tag
// makes those clients ignore comparisons safely during mixed-version sync.
export const COMPARISON_RECORD_MODEL = `${CLIP_TAG}:pairwise-v1`;
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
export function encodeFullFeatures(features) {
  if (features.length !== PREFERENCE_DIMENSION || !Array.from(features).every(Number.isFinite)) throw new Error('Invalid preference features.');
  const bytes = new Uint8Array(features.length * 4), view = new DataView(bytes.buffer);
  features.forEach((value, index) => view.setFloat32(index * 4, Math.max(-1, Math.min(1, value)), true));
  return `f32:${bytesToBase64(bytes)}`;
}
export function decodeFeatures(encoded) {
  if (typeof encoded === 'string' && encoded.startsWith('f32:')) {
    const body = encoded.slice(4);
    if (body.length !== 2748 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error('Invalid preference record.');
    const bytes = base64ToBytes(body);
    if (bytes.length !== PREFERENCE_DIMENSION * 4) throw new Error('Invalid preference record.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), result = Array.from({ length: PREFERENCE_DIMENSION }, (_, index) => view.getFloat32(index * 4, true));
    if (!result.every(value => Number.isFinite(value) && Math.abs(value) <= 1)) throw new Error('Invalid preference record.');
    return result;
  }
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
export const imageLearningRecordKey = record => `${record.id}|${record.updatedAt}|${record.label}|${record.features}${record.kind === 'comparison' ? `|${record.preferredFeatures}` : ''}`;
export function mergeImageLearning(left = {}, right = {}) {
  left = left && typeof left === 'object' ? left : {};
  right = right && typeof right === 'object' ? right : {};
  const resetAt = time(left.resetAt) >= time(right.resetAt) ? left.resetAt || '' : right.resetAt || '';
  const records = new Map();
  for (const item of [...(Array.isArray(left.records) ? left.records : []), ...(Array.isArray(right.records) ? right.records : [])]) {
    if (!item || typeof item.id !== 'string' || item.id.length > 3000 || item.model !== (item.kind === 'comparison' ? COMPARISON_RECORD_MODEL : CLIP_TAG) || ![0, 1].includes(item.label)
      || time(item.updatedAt) <= time(resetAt) || !time(item.updatedAt)) continue;
    try {
      decodeFeatures(item.features);
      if (item.kind === 'comparison') {
        if (item.label !== 0) continue;
        decodeFeatures(item.preferredFeatures);
      } else if (item.kind !== undefined) continue;
    } catch { continue; }
    const clean = { id: item.id, model: item.model, label: item.label, features: item.features, updatedAt: item.updatedAt };
    if (item.kind === 'comparison') Object.assign(clean, { kind: 'comparison', preferredFeatures: item.preferredFeatures });
    const previous = records.get(clean.id);
    // A stable tie-break makes concurrent edits converge on both devices.
    if (!previous || time(clean.updatedAt) > time(previous.updatedAt)
      || (time(clean.updatedAt) === time(previous.updatedAt) && JSON.stringify(clean) > JSON.stringify(previous))) records.set(clean.id, clean);
  }
  return { version: 1, resetAt, records: [...records.values()].sort((a, b) => time(a.updatedAt) - time(b.updatedAt) || a.id.localeCompare(b.id)) };
}
export function fitPreferences(records, previous = null) {
  // Legacy replay bound, never a retention limit. Production learning uses the
  // versioned meaning-conditioned worker; this fitter remains for migration.
  records = records.slice(-MAX_LABELS);
  const examples = records.filter(record => record.kind !== 'comparison').map(record => ({ x: decodeFeatures(record.features), y: record.label }));
  const comparisons = records.filter(record => record.kind === 'comparison').map(record => {
    const losing = decodeFeatures(record.features);
    return decodeFeatures(record.preferredFeatures).map((value, index) => value - losing[index]);
  });
  const positives = examples.filter(item => item.y).length;
  const negatives = examples.length - positives;
  if (records.length < MIN_LABELS || positives < 2 || negatives + comparisons.length < 2) return null;
  // A normal choice proves relative preference, not that every alternative is
  // unsuitable. Without explicit rejections train the pairwise objective only;
  // positive-only classification would otherwise push its intercept upward.
  const classify = negatives >= 2;
  const weights = Array(PREFERENCE_DIMENSION + 1).fill(0);
  // Refit a bounded, balanced replay set instead of repeatedly fitting the last click.
  for (let epoch = 0; epoch < 40; epoch++) {
    const gradient = weights.map((value, index) => value * (index === PREFERENCE_DIMENSION ? 0.05 : 0.2));
    for (const { x, y } of classify ? examples : []) {
      const z = weights[PREFERENCE_DIMENSION] + x.reduce((sum, value, index) => sum + value * weights[index], 0);
      const error = (sigmoid(z) - y) * 0.5 / (y ? positives : negatives);
      for (let index = 0; index < x.length; index++) gradient[index] += error * x[index];
      gradient[PREFERENCE_DIMENSION] += error;
    }
    for (const difference of comparisons) {
      const z = difference.reduce((sum, value, index) => sum + value * weights[index], 0);
      const error = (sigmoid(z) - 1) * 0.5 / comparisons.length;
      for (let index = 0; index < difference.length; index++) gradient[index] += error * difference[index];
    }
    for (let index = 0; index < weights.length; index++) weights[index] -= 0.4 * gradient[index];
  }
  const before = previous?.weights?.length === weights.length ? previous.weights : weights.map(() => 0);
  const deltaL2 = Math.hypot(...weights.map((value, index) => value - before[index]));
  return { model: CLIP_TAG, weights, revision: (Number(previous?.revision) || 0) + 1, trainedLabels: records.length,
    trainedRecordIds: records.map(imageLearningRecordKey),
    trainedComparisons: comparisons.length, trainedPositiveLabels: positives, trainedNegativeLabels: negatives,
    fingerprint: parameterFingerprint(weights), beforeFingerprint: parameterFingerprint(before), deltaL2,
    changedParameters: weights.filter((value, index) => Math.abs(value - before[index]) > 1e-9).length,
    updatedAt: new Date().toISOString() };
}
export function updatePreferenceModel(data, previous = null) {
  const records = mergeImageLearning(data).records;
  const trained = new Set(previous?.trainedRecordIds || []);
  const queued = records.filter(record => !trained.has(imageLearningRecordKey(record))).length;
  const removed = (previous?.trainedRecordIds || []).some(key => !records.some(record => key === imageLearningRecordKey(record)));
  if (previous && !removed && queued < TRAIN_BATCH) return { model: previous, queued, trained: false };
  const model = fitPreferences(records, previous);
  return { model, queued: model ? 0 : queued, trained: Boolean(model) };
}
export function preferenceProbability(model, features) {
  if (!model || model.model !== CLIP_TAG || model.weights?.length !== features.length + 1 || !model.weights.every(Number.isFinite)) return 0.5;
  return sigmoid(features.reduce((sum, value, index) => sum + value * model.weights[index], model.weights.at(-1)));
}
