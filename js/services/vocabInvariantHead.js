import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { cosine, normalizedVector } from './imagePreferences.js';
import { fitLogisticHead, validLogisticHead, logisticScore, logisticPrior } from './learnedScorer.js';

export const INVARIANT_HEAD_VERSION = 'multi-view-invariant-12-v1';
export const INVARIANT_FEATURES = ['meaningFull', 'meaningCrop', 'meaningBlend', 'sceneFull', 'sceneCrop', 'sceneBlend',
  'sceneCropDelta', 'meaningCropDelta', 'contrastMarginBlend', 'contrastMarginCrop', 'unwantedMinusSelected', 'backgroundProjection'];
const validVector = v => Array.isArray(v) && v.length === CLIP_DIMENSION && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < .02;
export function validRankingEvidence(e) {
  return Boolean(e && e.encoder === CLIP_TAG && ['full', 'crop', 'meaning', 'scene', 'unwanted'].every(key => validVector(e[key]))
    && (e.contrast === null || validVector(e.contrast)));
}
export function validInvariantHead(head) {
  return Boolean(head?.version === INVARIANT_HEAD_VERSION && head.encoder === CLIP_TAG && head.dimension === CLIP_DIMENSION
    && Array.isArray(head.uBg) && head.uBg.length === CLIP_DIMENSION && head.uBg.every(Number.isFinite)
    && (Math.hypot(...head.uBg) < 1e-8 || Math.abs(Math.hypot(...head.uBg) - 1) < .02)
    && Number.isFinite(head.backgroundStrength) && head.backgroundStrength >= 0 && head.backgroundStrength <= 1
    && Array.isArray(head.fisherDiag) && head.fisherDiag.length === CLIP_DIMENSION && head.fisherDiag.every(x => x >= .75 && x <= 1.35)
    && validLogisticHead(head.scorer, 12));
}
export function cleanInvariantVector(vector, head, alpha) {
  const projection = vector.reduce((sum, v, i) => sum + v * head.uBg[i], 0);
  const strength = head.backgroundStrength ?? 1;
  return normalizedVector(vector.map((v, i) => (v - alpha * strength * projection * head.uBg[i]) * head.fisherDiag[i]));
}
export function invariantFeatures(evidence, head = null) {
  const e = evidence;
  const blend = normalizedVector(e.full.map((v, i) => .55 * v + .45 * e.crop[i]));
  const full = head ? cleanInvariantVector(e.full, head, .22) : e.full;
  const crop = head ? cleanInvariantVector(e.crop, head, .08) : e.crop;
  const mixed = head ? cleanInvariantVector(blend, head, .15) : blend;
  const df = cosine(full, e.meaning), dc = cosine(crop, e.meaning), db = cosine(mixed, e.meaning);
  const sf = cosine(full, e.scene), sc = cosine(crop, e.scene), sb = cosine(mixed, e.scene);
  const selected = .35 * db + .65 * sb;
  const margin = e.contrast ? selected - cosine(mixed, e.contrast) : 0;
  const cropMargin = e.contrast ? .35 * dc + .65 * sc - cosine(crop, e.contrast) : 0;
  const background = head ? (head.backgroundStrength ?? 1) * e.full.reduce((sum, v, i) => sum + (v - e.crop[i]) * head.uBg[i], 0) : 0;
  return [df, dc, db, sf, sc, sb, sc - sf, dc - df, margin, cropMargin, cosine(mixed, e.unwanted) - selected, background];
}
export function invariantRankingScore(head, evidence) {
  if (!validInvariantHead(head) || !validRankingEvidence(evidence)) return null;
  return logisticScore(head.scorer, invariantFeatures(evidence, head));
}
export function fitInvariantHead(records, initialization = null) {
  // Relative losers are not semantic negatives. A foreground reason is explicit;
  // ordinary wrong-meaning labels cannot identify a background direction.
  const examples = records.filter(r => r.kind !== 'comparison' && [0, 1].includes(r.label) && validRankingEvidence(r.rankingEvidence));
  const positive = examples.filter(r => r.label === 1), negative = examples.filter(r => r.label === 0);
  if (positive.length < 2 || negative.length < 2) return null;
  const foreground = negative.filter(r => r.feedbackReason === 'background');
  const mass = row => Number.isFinite(row.sampleWeight) && row.sampleWeight > 0 ? row.sampleWeight : 1;
  const foregroundMass = foreground.reduce((s, row) => s + mass(row), 0);
  const uBg = Array(CLIP_DIMENSION).fill(0);
  if (foreground.length) {
    for (const row of foreground) for (let j = 0; j < CLIP_DIMENSION; j++) uBg[j] += mass(row) * (row.rankingEvidence.full[j] - row.rankingEvidence.crop[j]) / foregroundMass;
    const norm = Math.hypot(...uBg);
    if (norm > 1e-8) for (let j = 0; j < CLIP_DIMENSION; j++) uBg[j] /= norm;
  }
  const means = rows => {
    const sum = Array(CLIP_DIMENSION).fill(0);
    const total = rows.reduce((s, row) => s + mass(row), 0);
    for (const r of rows) {
      const e = r.rankingEvidence, blend = normalizedVector(e.full.map((v, j) => .55 * v + .45 * e.crop[j]));
      for (let j = 0; j < CLIP_DIMENSION; j++) sum[j] += mass(r) * blend[j] * e.scene[j] / total;
    }
    return sum;
  };
  const pos = means(positive), neg = means(negative);
  const independentMeanings = new Set(examples.map((r, i) => r.meaningId || r.context?.word || `example-${i}`)).size;
  const shrinkage = independentMeanings / (independentMeanings + 40);
  const fisherDiag = pos.map((value, j) => Math.max(.75, Math.min(1.35, 1 + 18 * shrinkage * (value - neg[j]))));
  const seeded = validInvariantHead(initialization);
  if (seeded) {
    const strength = independentMeanings / (independentMeanings + 32);
    for (let j = 0; j < CLIP_DIMENSION; j++) fisherDiag[j] = strength * fisherDiag[j] + (1 - strength) * initialization.fisherDiag[j];
    if (!foreground.length) for (let j = 0; j < CLIP_DIMENSION; j++) uBg[j] = initialization.uBg[j];
  }
  const foregroundCount = foreground.length || (seeded ? initialization.foregroundCount : 0);
  const head = { version: INVARIANT_HEAD_VERSION, encoder: CLIP_TAG, dimension: CLIP_DIMENSION, uBg, fisherDiag,
    sampleCount: examples.length, independentMeanings, foregroundCount, backgroundStrength: Math.min(1, foregroundCount / 12) };
  head.scorer = fitLogisticHead(examples.map(r => invariantFeatures(r.rankingEvidence, head)), examples.map(r => r.label),
    { ...(seeded ? logisticPrior(initialization.scorer) : { prior: [0, 0, 2.8, 0, 0, 5.2, 1.2, 0, 4.8, 0, -2, -1.2], bias: -1.6 }), sampleWeights: examples.map(mass),
      balanceClasses: !examples.some(r => r.samplingStratum), effectiveSampleCount: independentMeanings });
  return validInvariantHead(head) ? head : null;
}
