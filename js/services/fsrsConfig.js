import { default_w, clipParameters, fsrs, createEmptyCard, State, FSRSAlgorithm, dateDiffInDays } from '../vendor/fsrs.js';
export const FSRS_MODEL = 'FSRS-6';
export const FSRS_CHANNELS = ['recall', 'recognition', 'assisted'];
export const FSRS_DEFAULT_WEIGHTS = [...default_w];
export const FSRS_DAY_MS = 86400000;
const clamp = (value, min, max, fallback) => value != null && value !== '' && Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
export function validFsrsWeights(value) {
  return Array.isArray(value) && value.length === 21 && value.every(Number.isFinite)
    && clipParameters(value, 1, true).every((item, index) => Math.abs(item - value[index]) < 1e-8);
}
export function normalizeFsrsConfig(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const models = {};
  for (const channel of FSRS_CHANNELS) {
    const model = value.models?.[channel];
    if (model?.algorithm === FSRS_MODEL && validFsrsWeights(model.weights)) models[channel] = {
      ...model, before: model.before && typeof model.before === 'object' ? model.before : {}, after: model.after && typeof model.after === 'object' ? model.after : {},
      changedParameters: Math.round(clamp(model.changedParameters, 0, 21, 0)), deltaL2: clamp(model.deltaL2, 0, 1000000, 0), weights: [...model.weights], revision: Math.max(0, Math.round(Number(model.revision) || 0)),
      // A calibration head is optional and only accepted after held-out evaluation.
      calibration: Array.isArray(model.calibration) && model.calibration.length <= 40 && model.calibration.every(Number.isFinite) ? [...model.calibration] : null
    };
  }
  return { version: 1, retention: clamp(value.retention, 0.8, 0.97, 0.9), maximumInterval: Math.round(clamp(value.maximumInterval, 30, 3650, 365)),
    automaticTraining: value.automaticTraining !== false, models, updatedAt: String(value.updatedAt || '') };
}
let previousSettings;
let previousConfig;
export function readFsrsConfig(settings) {
  if (settings) return normalizeFsrsConfig(settings.fsrs || settings);
  try {
    const raw = globalThis.localStorage?.getItem('keepvocab_settings') || '';
    if (raw !== previousSettings) { previousSettings = raw; previousConfig = normalizeFsrsConfig(JSON.parse(raw || '{}').fsrs); }
    return previousConfig || normalizeFsrsConfig();
  } catch { return normalizeFsrsConfig(); }
}
export function mergeFsrsConfig(left, right, preferred) {
  const a = normalizeFsrsConfig(left), b = normalizeFsrsConfig(right);
  const preferredConfig = (Date.parse(a.updatedAt) || 0) > (Date.parse(b.updatedAt) || 0) ? a
    : (Date.parse(b.updatedAt) || 0) > (Date.parse(a.updatedAt) || 0) ? b : preferred || left || right;
  const base = normalizeFsrsConfig(preferredConfig);
  for (const channel of FSRS_CHANNELS) {
    const candidates = [a.models[channel], b.models[channel]].filter(Boolean).sort((x, y) =>
      (Date.parse(y.trainedAt) || 0) - (Date.parse(x.trainedAt) || 0) || JSON.stringify(y).localeCompare(JSON.stringify(x)));
    if (candidates[0]) base.models[channel] = candidates[0];
  }
  return base;
}
const schedulers = new Map();
export function fsrsScheduler(config, channel = 'recall') {
  config = normalizeFsrsConfig(config);
  const weights = config.models[channel]?.weights || FSRS_DEFAULT_WEIGHTS;
  const key = JSON.stringify([weights, config.retention, config.maximumInterval]);
  if (!schedulers.has(key)) {
    schedulers.set(key, fsrs({ w: weights, request_retention: config.retention, maximum_interval: config.maximumInterval,
      enable_fuzz: false, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] }));
    if (schedulers.size > 8) schedulers.delete(schedulers.keys().next().value);
  }
  return schedulers.get(key);
}
export function serializeFsrsCard(card) {
  return { due: new Date(card.due).toISOString(), stability: card.stability, difficulty: card.difficulty,
    elapsed_days: card.elapsed_days, scheduled_days: card.scheduled_days, reps: card.reps, lapses: card.lapses,
    learning_steps: card.learning_steps, state: card.state, last_review: card.last_review ? new Date(card.last_review).toISOString() : null };
}
export function deserializeFsrsCard(value, now = new Date()) {
  if (!value || !Number.isFinite(Date.parse(value.due)) || ![0, 1, 2, 3].includes(value.state)
    || !['stability', 'difficulty', 'reps', 'lapses', 'scheduled_days', 'elapsed_days', 'learning_steps'].every(key => Number.isFinite(value[key]) && value[key] >= 0)
    || value.stability > 36500 || value.difficulty > 10 || (value.state !== State.New && (value.stability < 0.001 || value.difficulty < 1 || !Number.isFinite(Date.parse(value.last_review))))) return createEmptyCard(now);
  return { ...value, due: new Date(value.due), last_review: value.last_review ? new Date(value.last_review) : undefined };
}
export function reviewChannel(result = {}) {
  if (result.hintsUsed > 0) return 'assisted';
  if (result.recallType === 'recognition' || (result.recallType === 'context' && !result.producedUnaided)) return 'recognition';
  return result.correct && result.producedUnaided === false ? 'assisted' : 'recall';
}
export function elapsedFsrsDays(previous, now) { return previous ? Math.max(0, dateDiffInDays(new Date(previous), new Date(now))) : 0; }
export function rawFsrsRetrievability(word, now = new Date(), settings) {
  const card = word?.srs?.cards?.recall;
  if (card?.state === State.New) return null;
  const last = card?.last_review || word?.practiceStats?.lastUnaidedRecallAt || word?.lastRecalledAt || word?.lastReviewedAt;
  const stability = card?.stability || word?.srs?.stabilityDays;
  if (!last || !(stability > 0)) return null;
  const config = readFsrsConfig(settings);
  const algorithm = fsrsScheduler(config, 'recall');
  return algorithm.forgetting_curve(elapsedFsrsDays(last, now), stability);
}
export { createEmptyCard, State, FSRSAlgorithm };
