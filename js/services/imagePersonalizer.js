import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { decodeFeatures, encodeFullFeatures, normalizedVector, sigmoid } from './imagePreferences.js';

export const PERSONALIZER_VERSION = 'meaning-mlp-32-16-v1';
export const IMAGE_PREPROCESSING = 'full-frame-letterbox-256-v1';
export const PERSONALIZER_INPUTS = CLIP_DIMENSION * 3 + 3;
export const PERSONALIZER_LAYERS = [PERSONALIZER_INPUTS, 32, 16, 1];
export const PERSONALIZER_PARAMETERS = 49825;
export const PERSONALIZER_LIMIT = .08;
const layers = [[PERSONALIZER_INPUTS, 32], [32, 16], [16, 1]];
const offsets = [];
let end = 0;
for (const [inputs, outputs] of layers) { offsets.push(end); end += inputs * outputs + outputs; }
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
export function encodeMeaning(vector) {
  return encodeFullFeatures([...normalizedVector(vector), 0, 0, 0]);
}
export function personalizerInput(features, meaningFeatures) {
  const image = decodeFeatures(features), meaning = decodeFeatures(meaningFeatures);
  const result = new Float32Array(PERSONALIZER_INPUTS);
  for (let i = 0; i < CLIP_DIMENSION; i++) {
    result[i] = image[i]; result[CLIP_DIMENSION + i] = meaning[i]; result[CLIP_DIMENSION * 2 + i] = image[i] * meaning[i];
  }
  result.set(image.slice(CLIP_DIMENSION), CLIP_DIMENSION * 3);
  return result;
}
export function validPersonalizer(model) {
  return Boolean(model?.version === PERSONALIZER_VERSION && model.encoder === CLIP_TAG && model.preprocessing === IMAGE_PREPROCESSING
    && model.weights?.length === PERSONALIZER_PARAMETERS && Array.from(model.weights).every(Number.isFinite));
}
export function createPersonalizer(seed = 78123) {
  const weights = new Float32Array(PERSONALIZER_PARAMETERS);
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return ((seed >>> 0) / 4294967296 - .5) * 2; };
  for (let layer = 0; layer < 2; layer++) {
    const [inputs, outputs] = layers[layer], start = offsets[layer];
    for (let i = 0; i < inputs * outputs; i++) weights[start + i] = random() * Math.sqrt(6 / inputs);
    for (let i = 0; i < outputs; i++) weights[start + inputs * outputs + i] = .01;
  }
  // A new residual is exactly zero: installing the head cannot change CLIP's ranking.
  return { version: PERSONALIZER_VERSION, encoder: CLIP_TAG, preprocessing: IMAGE_PREPROCESSING,
    layers: [...PERSONALIZER_LAYERS], weights, revision: 0, trainingDecisionIds: [] };
}
function forward(weights, input) {
  const activations = [input];
  for (let layer = 0; layer < layers.length; layer++) {
    const [inputs, outputs] = layers[layer], start = offsets[layer], previous = activations[layer], next = new Float32Array(outputs);
    for (let j = 0; j < outputs; j++) {
      let z = weights[start + inputs * outputs + j];
      for (let i = 0; i < inputs; i++) z += previous[i] * weights[start + j * inputs + i];
      next[j] = layer === 2 ? z : Math.max(0, z);
    }
    activations.push(next);
  }
  return activations;
}
function baseScore(features) {
  const x = decodeFeatures(features);
  return x[512] + .6 * x[513] - .25 * Math.max(0, x[514]);
}
export function personalizerScore(model, features, meaningFeatures) {
  const base = baseScore(features);
  if (!validPersonalizer(model) || !meaningFeatures) return base;
  const x = personalizerInput(features, meaningFeatures);
  let residual = PERSONALIZER_LIMIT * Math.tanh(forward(model.weights, x)[3][0]);
  // Preference never boosts an image toward a competing dictionary sense.
  if (decodeFeatures(features)[513] < 0) residual = Math.min(0, residual);
  return base + residual;
}
export function activeImageExamples(records = [], resetAt = '') {
  const latest = new Map();
  for (const record of records) {
    if (!record?.meaningFeatures || record.preprocessing !== IMAGE_PREPROCESSING || record.encoder !== CLIP_TAG
      || Date.parse(record.updatedAt) <= (Date.parse(resetAt) || 0)) continue;
    try { decodeFeatures(record.features); decodeFeatures(record.meaningFeatures); if (record.kind === 'comparison') decodeFeatures(record.preferredFeatures); }
    catch { continue; }
    const previous = latest.get(record.key || record.id);
    if (!previous || record.updatedAt > previous.updatedAt || record.updatedAt === previous.updatedAt && record.id > previous.id) latest.set(record.key || record.id, record);
  }
  return [...latest.values()];
}
export function imageDecisions(records) {
  const groups = new Map();
  for (const record of records) {
    const id = record.decisionId || record.id;
    if (!groups.has(id)) groups.set(id, { id, meaningId: record.meaningId, occurredAt: record.updatedAt, records: [] });
    const group = groups.get(id); group.records.push(record);
    if (record.updatedAt < group.occurredAt) group.occurredAt = record.updatedAt;
  }
  return [...groups.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}
export function splitImageDecisions(records) {
  const decisions = imageDecisions(activeImageExamples(records));
  // A meaning (including all its photos/pairs/corrections) stays in one partition.
  const meanings = new Map();
  for (const decision of decisions) {
    const key = decision.meaningId || decision.id;
    if (!meanings.has(key)) meanings.set(key, []);
    meanings.get(key).push(decision);
  }
  const histories = [...meanings.values()].sort((a, b) => a.at(-1).occurredAt.localeCompare(b.at(-1).occurredAt));
  const a = Math.floor(histories.length * .6), b = Math.floor(histories.length * .8);
  return { train: histories.slice(0, a).flat(), validation: histories.slice(a, b).flat(), test: histories.slice(b).flat(), partitionUnit: 'meaning', decisions: decisions.length, meanings: histories.length };
}
function observations(decision) {
  const pairs = decision.records.filter(r => r.kind === 'comparison');
  if (pairs.length) return pairs.map(r => ({ winner: r.preferredFeatures, loser: r.features, meaning: r.meaningFeatures, weight: 1 / pairs.length }));
  return decision.records.filter(r => r.label === 0).map(r => ({ rejected: r.features, meaning: r.meaningFeatures, weight: 1 }));
}
function evaluateDecision(model, decision) {
  const rows = observations(decision); let loss = 0, wins = 0, rejectedAboveThreshold = 0;
  for (const row of rows) {
    const difference = row.rejected ? .3 - personalizerScore(model, row.rejected, row.meaning)
      : personalizerScore(model, row.winner, row.meaning) - personalizerScore(model, row.loser, row.meaning);
    if (row.rejected && difference <= 0) rejectedAboveThreshold++;
    const probability = sigmoid(difference * 8);
    loss -= Math.log(Math.max(1e-8, probability)) * row.weight;
    wins += Number(difference > 0) * row.weight;
  }
  return { loss, accuracy: wins, rejectedAboveThreshold, eligible: rows.length > 0 };
}
export function evaluatePersonalizer(model, decisions) {
  const rows = decisions.map(d => ({ id: d.id, meaningId: d.meaningId, ...evaluateDecision(model, d) })).filter(r => r.eligible);
  return { decisions: rows.length, rejectedAboveThreshold: rows.reduce((n, r) => n + r.rejectedAboveThreshold, 0), loss: rows.length ? rows.reduce((s, r) => s + r.loss, 0) / rows.length : null,
    accuracy: rows.length ? rows.reduce((s, r) => s + r.accuracy, 0) / rows.length : null, rows };
}
export function imageModelAcceptance(candidate, incumbent, test, { minimumDecisions = 12, bootstrapSamples = 300 } = {}) {
  const after = evaluatePersonalizer(candidate, test), before = evaluatePersonalizer(incumbent, test), baseline = evaluatePersonalizer(null, test);
  if (after.decisions < minimumDecisions) return { accepted: false, reason: 'More independent later choices are needed.', before, after, baseline };
  // Bootstrap whole meanings, never individual pairs from the same choice.
  const grouped = new Map();
  after.rows.forEach((row, i) => { const id = row.meaningId || row.id; if (!grouped.has(id)) grouped.set(id, []); grouped.get(id).push(Math.min(before.rows[i].loss, baseline.rows[i].loss) - row.loss); });
  const deltas = [...grouped.values()].map(xs => xs.reduce((a, b) => a + b, 0) / xs.length);
  if (deltas.length < 4) return { accepted: false, reason: 'More independent later meanings are needed.', before, after, baseline };
  let seed = 81273; const samples = [];
  for (let b = 0; b < bootstrapSamples; b++) { let sum = 0; for (let j = 0; j < deltas.length; j++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; sum += deltas[(seed >>> 0) % deltas.length]; } samples.push(sum / deltas.length); }
  samples.sort((a, b) => a - b); const lowerBound = samples[Math.floor(samples.length * .05)];
  const accepted = lowerBound > .001 && after.loss < Math.min(before.loss, baseline.loss) - .005 && after.accuracy >= before.accuracy && after.accuracy >= baseline.accuracy
    && after.rejectedAboveThreshold <= Math.min(before.rejectedAboveThreshold, baseline.rejectedAboveThreshold);
  return { accepted, lowerBound, before, after, baseline, reason: accepted ? 'Improved independent later choices.' : 'Current ranking retained; improvement was not reliable.' };
}
function backward(weights, activations, outputGradient, gradient) {
  let delta = new Float32Array([outputGradient]);
  for (let layer = 2; layer >= 0; layer--) {
    const [inputs, outputs] = layers[layer], start = offsets[layer], input = activations[layer], previous = new Float32Array(inputs);
    for (let j = 0; j < outputs; j++) {
      const d = delta[j]; gradient[start + inputs * outputs + j] += d;
      for (let i = 0; i < inputs; i++) { gradient[start + j * inputs + i] += d * input[i]; if (layer > 0) previous[i] += d * weights[start + j * inputs + i]; }
    }
    if (layer > 0) for (let i = 0; i < inputs; i++) if (input[i] <= 0) previous[i] = 0;
    delta = previous;
  }
}
export function trainImagePersonalizer(records, incumbent = null, { epochs = 20, batchSize = 8, maxMilliseconds = 20000, initialization = null, outputOnly = Boolean(incumbent?.pretrained || initialization?.pretrained), returnCandidate = false, progress = () => {} } = {}) {
  const split = splitImageDecisions(records);
  const report = { version: PERSONALIZER_VERSION, partitionUnit: split.partitionUnit, decisions: split.decisions, meanings: split.meanings };
  if (split.train.length < 24 || split.validation.length < 8 || split.test.length < 12) return { ...report, accepted: false, reason: 'Waiting for enough independent saved choices for validation.' };
  const heldIds = new Set([...split.validation, ...split.test].map(d => d.id));
  if ([...(incumbent?.trainingDecisionIds || []), ...(incumbent?.validationDecisionIds || []), ...(incumbent?.testDecisionIds || [])].some(id => heldIds.has(id))) return { ...report, accepted: false, reason: 'Waiting for later choices unseen by the current model.' };
  const model = validPersonalizer(incumbent) ? clone(incumbent) : validPersonalizer(initialization) ? clone(initialization) : createPersonalizer(); model.weights = Float32Array.from(model.weights);
  const initial = Float32Array.from(model.weights), momentum = new Float32Array(initial.length), variance = new Float32Array(initial.length);
  const training = split.train.map(d => ({ ...d, observations: observations(d).map(row => ({ ...row, a: personalizerInput(row.winner || row.rejected, row.meaning), b: row.loser ? personalizerInput(row.loser, row.meaning) : null })) })).filter(d => d.observations.length);
  const start = performance.now(); let step = 0, best = evaluatePersonalizer(model, split.validation).loss, bestWeights = Float32Array.from(initial), stale = 0;
  for (let epoch = 0; epoch < epochs && performance.now() - start < maxMilliseconds; epoch++) {
    // Rotate through the full training history; batch size never limits retention.
    const ordered = [...training.slice(epoch % training.length), ...training.slice(0, epoch % training.length)];
    for (let offset = 0; offset < ordered.length && performance.now() - start < maxMilliseconds; offset += batchSize) {
      const batch = ordered.slice(offset, offset + batchSize), gradient = new Float32Array(initial.length);
      for (const decision of batch) for (const row of decision.observations) {
        const a = forward(model.weights, row.a), b = row.b ? forward(model.weights, row.b) : null;
        const rawA = Math.tanh(a[3][0]), rawB = b ? Math.tanh(b[3][0]) : 0;
        const clampA = row.a[1537] < 0 && rawA > 0, clampB = b && row.b[1537] < 0 && rawB > 0;
        const ra = clampA ? 0 : rawA, rb = clampB ? 0 : rawB;
        const difference = b ? baseScore(row.winner) + PERSONALIZER_LIMIT * ra - baseScore(row.loser) - PERSONALIZER_LIMIT * rb : .3 - baseScore(row.rejected) - PERSONALIZER_LIMIT * ra;
        const error = (sigmoid(difference * 8) - 1) * 8 * row.weight / batch.length;
        backward(model.weights, a, clampA ? 0 : error * PERSONALIZER_LIMIT * (1 - ra * ra) * (b ? 1 : -1), gradient);
        if (b) backward(model.weights, b, clampB ? 0 : -error * PERSONALIZER_LIMIT * (1 - rb * rb), gradient);
      }
      step++;
      for (let i = outputOnly ? offsets[2] : 0; i < gradient.length; i++) {
        const g = Math.max(-1, Math.min(1, gradient[i] + .001 * (model.weights[i] - initial[i])));
        momentum[i] = .9 * momentum[i] + .1 * g; variance[i] = .999 * variance[i] + .001 * g * g;
        model.weights[i] -= .002 * (momentum[i] / (1 - .9 ** step)) / (Math.sqrt(variance[i] / (1 - .999 ** step)) + 1e-8);
      }
    }
    const validation = evaluatePersonalizer(model, split.validation).loss;
    if (validation < best - .0001) { best = validation; bestWeights = Float32Array.from(model.weights); stale = 0; } else stale++;
    progress({ epoch: epoch + 1, epochs, validationLoss: validation });
    if (stale >= 4) break;
  }
  model.weights = bestWeights;
  const result = imageModelAcceptance(model, incumbent, split.test);
  if (!result.accepted) return { ...report, ...result, ...(returnCandidate ? { candidate: { ...model, trainingDecisionIds: split.train.map(d => d.id) } } : {}) };
  Object.assign(model, { revision: (incumbent?.revision || 0) + 1, trainedAt: new Date().toISOString(), trainingDecisionIds: split.train.map(d => d.id),
    validationDecisionIds: split.validation.map(d => d.id), testDecisionIds: split.test.map(d => d.id), personalizationMode: outputOnly ? 'output-only' : 'full-head', validation: { ...result, before: { ...result.before, rows: undefined }, after: { ...result.after, rows: undefined }, baseline: { ...result.baseline, rows: undefined } } });
  return { ...report, ...result, model };
}
