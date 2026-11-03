import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { cosine } from './imagePreferences.js';
import { fitLogisticHead, validLogisticHead, logisticScore, logisticPrior } from './learnedScorer.js';

export const EQUIVALENCE_HEAD_VERSION = 'meaning-equivalence-11-v1';
export const EQUIVALENCE_FEATURES = ['rawCosine', 'cleanCosine', 'contextCosine', 'contextCleanEnsemble', 'agreement', 'difference',
  'meanAbsoluteDifference', 'jaccard', 'containment', 'headMatch', 'lengthRatio'];
const vector = v => Array.isArray(v) && v.length === CLIP_DIMENSION && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < .02;
export function validEquivalenceEvidence(e) {
  return Boolean(e?.encoder === CLIP_TAG && ['rawA', 'rawB', 'cleanA', 'cleanB', 'contextA', 'contextB'].every(k => vector(e[k]))
    && typeof e.definitionA === 'string' && typeof e.definitionB === 'string');
}
const tokens = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(t => t && !/^(a|an|the|to|of|and|or|be|is|that|which|with|for)$/.test(t));
export function equivalenceFeatures(e, head = null) {
  const raw = cosine(e.rawA, e.rawB), clean = cosine(e.cleanA, e.cleanB), context = cosine(e.contextA, e.contextB);
  let agreement = 0, difference = 0, l1 = 0;
  for (let j = 0; j < CLIP_DIMENSION; j++) {
    const product = e.cleanA[j] * e.cleanB[j], diff = Math.abs(e.cleanA[j] - e.cleanB[j]);
    agreement += (head?.wProd[j] || 0) * product;
    difference += (head?.wDiff[j] || 0) * diff;
    l1 += diff;
  }
  const a = tokens(e.definitionA), b = tokens(e.definitionB), sa = new Set(a), sb = new Set(b);
  const shared = [...sa].filter(t => sb.has(t)).length;
  return [raw, clean, context, .4 * context + .6 * clean, 10 * agreement, 10 * difference, l1 / CLIP_DIMENSION,
    shared / Math.max(1, new Set([...sa, ...sb]).size), shared / Math.max(1, Math.min(sa.size, sb.size)),
    Number(a.length > 0 && a[0] === b[0]), Math.min(a.length, b.length) / Math.max(1, a.length, b.length)];
}
export function validEquivalenceHead(head) {
  return Boolean(head?.version === EQUIVALENCE_HEAD_VERSION && head.encoder === CLIP_TAG && head.dimension === CLIP_DIMENSION
    && ['wProd', 'wDiff'].every(k => Array.isArray(head[k]) && head[k].length === CLIP_DIMENSION && head[k].every(Number.isFinite))
    && validLogisticHead(head.scorer, 11));
}
export function equivalenceProbability(head, evidence) {
  return validEquivalenceHead(head) && validEquivalenceEvidence(evidence) ? logisticScore(head.scorer, equivalenceFeatures(evidence, head)) : null;
}
export function fitEquivalenceHead(pairs = [], initialization = null) {
  const rows = pairs.filter(p => [0, 1].includes(p.label) && validEquivalenceEvidence(p.evidence));
  const positive = rows.filter(p => p.label === 1), negative = rows.filter(p => p.label === 0);
  if (positive.length < 2 || negative.length < 2) return null;
  const means = group => {
    const prod = Array(CLIP_DIMENSION).fill(0), diff = [...prod];
    for (const { evidence: e } of group) for (let j = 0; j < CLIP_DIMENSION; j++) {
      prod[j] += e.cleanA[j] * e.cleanB[j] / group.length;
      diff[j] += Math.abs(e.cleanA[j] - e.cleanB[j]) / group.length;
    }
    return { prod, diff };
  };
  const pos = means(positive), neg = means(negative);
  const head = { version: EQUIVALENCE_HEAD_VERSION, encoder: CLIP_TAG, dimension: CLIP_DIMENSION,
    wProd: pos.prod.map((v, j) => v - neg.prod[j]), wDiff: neg.diff.map((v, j) => v - pos.diff[j]), sampleCount: rows.length };
  if (validEquivalenceHead(initialization)) {
    const strength = rows.length / (rows.length + 64);
    for (const key of ['wProd', 'wDiff']) head[key] = head[key].map((v, j) => strength * v + (1 - strength) * initialization[key][j]);
  }
  head.scorer = fitLogisticHead(rows.map(r => equivalenceFeatures(r.evidence, head)), rows.map(r => r.label),
    validEquivalenceHead(initialization) ? logisticPrior(initialization.scorer) : { prior: [2, 2, 0, 2, 0, 0, -2, 1, 1, .2, .2], bias: -6 });
  return validEquivalenceHead(head) ? head : null;
}
