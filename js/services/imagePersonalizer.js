import { CLIP_TAG, CLIP_DIMENSION } from '../ml/clipConfig.js';
import { decodeFeatures, encodeFullFeatures, normalizedVector, sigmoid } from './imagePreferences.js';
import { IMAGE_TRAINING_RECIPE } from '../ml/imageTrainingRecipe.js';

export const LEGACY_PERSONALIZER_VERSION = 'meaning-mlp-32-16-v1';
export const PERSONALIZER_VERSION = 'meaning-mlp-32-16-fusion-v2';
export const IMAGE_PREPROCESSING = 'full-frame-letterbox-256-v1';
export const PERSONALIZER_INPUTS = CLIP_DIMENSION * 3 + 3;
export const PERSONALIZER_LAYERS = [PERSONALIZER_INPUTS, 32, 16, 1];
export const PERSONALIZER_PARAMETERS = 49825;
export const PERSONALIZER_LIMIT = .08;
export const PERSONAL_PREFERENCE_LIMIT = .04;
export const CLIP_FUSION_WEIGHT = .5;
export const MLP_FUSION_WEIGHT = .5;
export const PERSONALIZER_FIT_DEFAULTS = Object.freeze({ learningRate: .002, regularization: .001, beta1: .9, beta2: .999,
  epsilon: 1e-8, gradientClip: 1, maximumGradientNorm: 1, patience: 4, minimumImprovement: .0001 });
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
function validHead(model) {
  return Boolean([PERSONALIZER_VERSION, LEGACY_PERSONALIZER_VERSION].includes(model?.version) && model.encoder === CLIP_TAG && model.preprocessing === IMAGE_PREPROCESSING
    && model.weights?.length === PERSONALIZER_PARAMETERS && Array.from(model.weights).every(Number.isFinite));
}
export function validPersonalizer(model) {
  if (!validHead(model) || model.role && !['semantic', 'preference'].includes(model.role)) return false;
  // A personal model may contain one frozen semantic base, never a chain of
  // nested corrections. This also rejects cyclic or malformed imported models.
  return !model.semanticBase || model.role === 'preference' && validHead(model.semanticBase)
    && model.semanticBase.role === 'semantic' && !model.semanticBase.semanticBase
    && (model.semanticBase.genericValidation?.accepted ?? model.semanticBase.validation?.accepted) === true;
}
export function isCurrentPersonalizer(model) {
  return model?.version === PERSONALIZER_VERSION && validPersonalizer(model)
    && (!model.semanticBase || model.semanticBase.version === PERSONALIZER_VERSION);
}
export function isValidatedSemanticModel(model) {
  return isCurrentPersonalizer(model) && model.role === 'semantic'
    && (model.genericValidation?.accepted ?? model.validation?.accepted) === true;
}
export function createPreferencePersonalizer(semanticModel) {
  if (!isValidatedSemanticModel(semanticModel)) return null;
  const model = createPersonalizer(); model.weights = Float32Array.from(semanticModel.weights);
  // The personal branch starts at the exact validated semantic model. Its
  // immutable semantic copy is an acceptance comparator, not another fusion.
  return { ...model, role: 'preference', pretrained: true, semanticBase: clone(semanticModel),
    featureInitialization: { source: 'validated-semantic-head', dataset: semanticModel.genericValidation?.dataset || '',
      weightsSha256: semanticModel.genericValidation?.weightsSha256 || '' } };
}
export function createPersonalizer(seed = 78123) {
  const weights = new Float32Array(PERSONALIZER_PARAMETERS);
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return ((seed >>> 0) / 4294967296 - .5) * 2; };
  for (let layer = 0; layer < 2; layer++) {
    const [inputs, outputs] = layers[layer], start = offsets[layer];
    for (let i = 0; i < inputs * outputs; i++) weights[start + i] = random() * Math.sqrt(6 / inputs);
    for (let i = 0; i < outputs; i++) weights[start + inputs * outputs + i] = .01;
  }
  // Initialize five trainable routes to reproduce CLIP's three scalar signals:
  // selected +/-; competing-meaning margin +/-; max(0, unwanted). The MLP
  // initially agrees with CLIP, then all routes and nonlinear units can learn.
  for (let j = 0; j < 5; j++) {
    weights.fill(0, offsets[0] + j * PERSONALIZER_INPUTS, offsets[0] + (j + 1) * PERSONALIZER_INPUTS);
    weights[offsets[0] + PERSONALIZER_INPUTS * 32 + j] = 0;
    weights[offsets[0] + j * PERSONALIZER_INPUTS + 1536 + Math.floor(j / 2)] = j % 2 ? -1 : 1;
    weights.fill(0, offsets[1] + j * 32, offsets[1] + (j + 1) * 32);
    weights[offsets[1] + j * 32 + j] = 1;
    weights[offsets[1] + 32 * 16 + j] = 0;
  }
  weights.set([1, -1, .6, -.6, -.25], offsets[2]);
  return { version: PERSONALIZER_VERSION, encoder: CLIP_TAG, preprocessing: IMAGE_PREPROCESSING,
    layers: [...PERSONALIZER_LAYERS], weights, role: 'preference', revision: 0, trainingDecisionIds: [] };
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
const residualLimit = model => model?.role === 'preference' ? PERSONAL_PREFERENCE_LIMIT : PERSONALIZER_LIMIT;
function frozenBaseScore(model, features, meaningFeatures) {
  if (model?.version === PERSONALIZER_VERSION) return baseScore(features);
  const archivedBase = model?.semanticBase;
  return model?.role === 'preference' && validPersonalizer(archivedBase) && archivedBase.role === 'semantic'
    && (archivedBase.genericValidation?.accepted ?? archivedBase.validation?.accepted) === true
    ? personalizerScore(model.semanticBase, features, meaningFeatures) : baseScore(features);
}
export function personalizerScore(model, features, meaningFeatures) {
  if (!validPersonalizer(model) || !meaningFeatures) return baseScore(features);
  return scoreValidPersonalizer(model, features, meaningFeatures);
}
function scoreValidPersonalizer(model, features, meaningFeatures) {
  if (model.version === PERSONALIZER_VERSION) {
    const learned = forward(model.weights, personalizerInput(features, meaningFeatures))[3][0];
    return CLIP_FUSION_WEIGHT * baseScore(features) + MLP_FUSION_WEIGHT * learned;
  }
  const base = frozenBaseScore(model, features, meaningFeatures);
  const x = personalizerInput(features, meaningFeatures);
  let residual = residualLimit(model) * Math.tanh(forward(model.weights, x)[3][0]);
  // Preference never boosts an image toward a competing dictionary sense.
  if (decodeFeatures(features)[513] < 0) residual = Math.min(0, residual);
  return base + residual;
}
// A fixed evaluation pass validates weights once, rather than scanning all
// 49,825 parameters for every photo. Callers must not mutate the model mid-pass.
export function createPersonalizerScorer(model) {
  const valid = validPersonalizer(model);
  return (features, meaningFeatures) => valid && meaningFeatures
    ? scoreValidPersonalizer(model, features, meaningFeatures) : baseScore(features);
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
/** Freeze independently curated semantic partitions rather than reassigning
 * meanings after ambiguous galleries have been excluded during visual review. */
export function semanticDatasetPartitions(records, idsBySplit) {
  const names = ['train', 'validation', 'test'];
  if (!idsBySplit || typeof idsBySplit !== 'object' || names.some(name => !Array.isArray(idsBySplit[name]))
    || Object.keys(idsBySplit).some(name => !names.includes(name))) throw new Error('Semantic dataset partitions require train, validation and test ID arrays.');
  const active = activeImageExamples(records);
  if (active.some(record => record.task !== 'semantic')) throw new Error('Explicit dataset partitions accept semantic training records only.');
  const decisions = imageDecisions(active), byId = new Map(decisions.map(decision => [decision.id, decision]));
  const used = new Set(), meaningSplits = new Map(), partition = {};
  for (const name of names) {
    partition[name] = idsBySplit[name].map(id => {
      if (typeof id !== 'string' || !byId.has(id)) throw new Error(`Unknown semantic dataset decision: ${String(id)}`);
      if (used.has(id)) throw new Error(`Duplicate semantic dataset decision: ${id}`);
      used.add(id);
      const decision = byId.get(id), meaning = decision.meaningId || decision.id;
      if (decision.records.some(record => (record.meaningId || decision.id) !== meaning)) throw new Error(`Semantic decision contains mixed meanings: ${id}`);
      if (meaningSplits.has(meaning) && meaningSplits.get(meaning) !== name) throw new Error(`Semantic meaning crosses dataset partitions: ${meaning}`);
      meaningSplits.set(meaning, name); return decision;
    });
  }
  if (used.size !== decisions.length) throw new Error('Semantic dataset partitions are missing active decisions.');
  return { ...partition, partitionUnit: 'meaning', decisions: decisions.length, meanings: meaningSplits.size, explicit: true };
}
function observations(decision) {
  const pairs = decision.records.filter(r => r.kind === 'comparison');
  if (pairs.length) return pairs.map(r => ({ winner: r.preferredFeatures, loser: r.features, meaning: r.meaningFeatures, weight: 1 / pairs.length }));
  return decision.records.filter(r => r.label === 0).map(r => ({ rejected: r.features, meaning: r.meaningFeatures, weight: 1 }));
}
function evaluateDecision(score, decision) {
  const rows = observations(decision); let loss = 0, wins = 0, rejectedAboveThreshold = 0;
  for (const row of rows) {
    const difference = row.rejected ? .3 - score(row.rejected, row.meaning)
      : score(row.winner, row.meaning) - score(row.loser, row.meaning);
    if (row.rejected && difference <= 0) rejectedAboveThreshold++;
    const probability = sigmoid(difference * 8);
    loss -= Math.log(Math.max(1e-8, probability)) * row.weight;
    wins += Number(difference > 0) * row.weight;
  }
  return { loss, accuracy: wins, rejectedAboveThreshold, eligible: rows.length > 0 };
}
export function evaluatePersonalizer(model, decisions) {
  const score = createPersonalizerScorer(model);
  const rows = decisions.map(d => ({ id: d.id, meaningId: d.meaningId, ...evaluateDecision(score, d) })).filter(r => r.eligible);
  return { decisions: rows.length, rejectedAboveThreshold: rows.reduce((n, r) => n + r.rejectedAboveThreshold, 0), loss: rows.length ? rows.reduce((s, r) => s + r.loss, 0) / rows.length : null,
    accuracy: rows.length ? rows.reduce((s, r) => s + r.accuracy, 0) / rows.length : null, rows };
}
export function imageModelAcceptance(candidate, incumbent, test, { minimumDecisions = 12, bootstrapSamples = 300 } = {}) {
  const semanticModel = candidate?.role === 'preference' && isValidatedSemanticModel(candidate.semanticBase) ? candidate.semanticBase : null;
  const after = evaluatePersonalizer(candidate, test), before = evaluatePersonalizer(incumbent || semanticModel, test), baseline = evaluatePersonalizer(null, test);
  const semanticBaseline = evaluatePersonalizer(semanticModel, test);
  if (after.decisions < minimumDecisions) return { accepted: false, reason: 'More independent later choices are needed.', before, after, baseline };
  // Bootstrap whole meanings, never individual pairs from the same choice.
  const grouped = new Map();
  after.rows.forEach((row, i) => { const id = row.meaningId || row.id; if (!grouped.has(id)) grouped.set(id, []); grouped.get(id).push(Math.min(before.rows[i].loss, baseline.rows[i].loss, semanticBaseline.rows[i].loss) - row.loss); });
  const deltas = [...grouped.values()].map(xs => xs.reduce((a, b) => a + b, 0) / xs.length);
  if (deltas.length < 4) return { accepted: false, reason: 'More independent later meanings are needed.', before, after, baseline };
  let seed = 81273; const samples = [];
  for (let b = 0; b < bootstrapSamples; b++) { let sum = 0; for (let j = 0; j < deltas.length; j++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; sum += deltas[(seed >>> 0) % deltas.length]; } samples.push(sum / deltas.length); }
  samples.sort((a, b) => a - b); const lowerBound = samples[Math.floor(samples.length * .05)];
  const accepted = lowerBound > .001 && after.loss < Math.min(before.loss, baseline.loss, semanticBaseline.loss) - .005 && after.accuracy >= before.accuracy && after.accuracy >= baseline.accuracy && after.accuracy >= semanticBaseline.accuracy
    && after.rejectedAboveThreshold <= Math.min(before.rejectedAboveThreshold, baseline.rejectedAboveThreshold, semanticBaseline.rejectedAboveThreshold);
  return { accepted, lowerBound, before, after, baseline, semanticBaseline, reason: accepted ? 'Improved independent later choices.' : 'Current ranking retained; improvement was not reliable.' };
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
function preparedDecisions(model, decisions) {
  return decisions.map(d => ({ ...d, observations: observations(d).map(row => ({ ...row,
    a: personalizerInput(row.winner || row.rejected, row.meaning), b: row.loser ? personalizerInput(row.loser, row.meaning) : null,
    baseA: frozenBaseScore(model, row.winner || row.rejected, row.meaning), baseB: row.loser ? frozenBaseScore(model, row.loser, row.meaning) : null
  })) })).filter(d => d.observations.length);
}
function batchGradient(model, batch) {
  const gradient = new Float32Array(PERSONALIZER_PARAMETERS), limit = residualLimit(model);
  for (const decision of batch) for (const row of decision.observations) {
    const a = forward(model.weights, row.a), b = row.b ? forward(model.weights, row.b) : null;
    if (model.version === PERSONALIZER_VERSION) {
      const scoreA = CLIP_FUSION_WEIGHT * row.baseA + MLP_FUSION_WEIGHT * a[3][0];
      const scoreB = b ? CLIP_FUSION_WEIGHT * row.baseB + MLP_FUSION_WEIGHT * b[3][0] : .3;
      const difference = b ? scoreA - scoreB : .3 - scoreA;
      const error = (sigmoid(difference * 8) - 1) * 8 * row.weight / batch.length;
      backward(model.weights, a, error * MLP_FUSION_WEIGHT * (b ? 1 : -1), gradient);
      if (b) backward(model.weights, b, -error * MLP_FUSION_WEIGHT, gradient);
      continue;
    }
    const rawA = Math.tanh(a[3][0]), rawB = b ? Math.tanh(b[3][0]) : 0;
    const clampA = row.a[1537] < 0 && rawA > 0, clampB = b && row.b[1537] < 0 && rawB > 0;
    const ra = clampA ? 0 : rawA, rb = clampB ? 0 : rawB;
    const difference = b ? row.baseA + limit * ra - row.baseB - limit * rb : .3 - row.baseA - limit * ra;
    const error = (sigmoid(difference * 8) - 1) * 8 * row.weight / batch.length;
    backward(model.weights, a, clampA ? 0 : error * limit * (1 - ra * ra) * (b ? 1 : -1), gradient);
    if (b) backward(model.weights, b, clampB ? 0 : -error * limit * (1 - rb * rb), gradient);
  }
  return gradient;
}
// Offline diagnostics use the exact gradient and objective used by app fitting.
// This helper does not authorize or activate a model.
export function personalizerLossAndGradient(model, decisions) {
  if (!validPersonalizer(model) || !decisions.length) throw new Error('A current model and nonempty decisions are required.');
  const batch = preparedDecisions(model, decisions);
  if (!batch.length) throw new Error('No usable observations.');
  return { loss: evaluatePersonalizer(model, decisions).loss, gradient: batchGradient(model, batch) };
}
export function personalizerActivationSignature(model, decisions) {
  if (!validPersonalizer(model)) throw new Error('A current model is required.');
  const parts = [];
  for (const decision of preparedDecisions(model, decisions)) for (const row of decision.observations) {
    for (const input of [row.a, row.b].filter(Boolean)) {
      const state = forward(model.weights, input);
      parts.push(...state[1].map(value => Number(value > 0)), ...state[2].map(value => Number(value > 0)),
        Number(model.version === LEGACY_PERSONALIZER_VERSION && input[1537] < 0 && state[3][0] > 0));
    }
  }
  return parts.join('');
}
// Shared numerical fitting core. The public trainer below owns split validation,
// minimum-data requirements and acceptance; fitting alone never activates a head.
export function fitImagePersonalizer(initialModel, train, validation, { epochs = 20, batchSize = 8, maxMilliseconds = 20000,
  outputOnly = false, learningRate = PERSONALIZER_FIT_DEFAULTS.learningRate, regularization = PERSONALIZER_FIT_DEFAULTS.regularization,
  patience = PERSONALIZER_FIT_DEFAULTS.patience, minimumImprovement = PERSONALIZER_FIT_DEFAULTS.minimumImprovement,
  maximumGradientNorm = PERSONALIZER_FIT_DEFAULTS.maximumGradientNorm, checkpoint = 'validation',
  progress = () => {}, observeEpoch = () => {} } = {}) {
  if (!isCurrentPersonalizer(initialModel) || !train.length || !validation.length) throw new Error('Fitting requires a current model and nonempty training/validation decisions.');
  if (!Number.isInteger(epochs) || epochs < 1 || !Number.isInteger(batchSize) || batchSize < 1 || !(learningRate > 0)
    || !Number.isFinite(learningRate) || !(regularization >= 0) || !Number.isFinite(regularization) || !(maxMilliseconds > 0) || !(patience > 0)
    || !(maximumGradientNorm > 0) || !Number.isFinite(maximumGradientNorm) || !['validation', 'last'].includes(checkpoint)) throw new Error('Invalid fitting hyperparameters.');
  const model = clone(initialModel); model.weights = Float32Array.from(model.weights);
  const initial = Float32Array.from(model.weights), momentum = new Float32Array(initial.length), variance = new Float32Array(initial.length);
  const training = preparedDecisions(model, train);
  if (!training.length) throw new Error('No usable training observations.');
  const { beta1, beta2, epsilon } = PERSONALIZER_FIT_DEFAULTS;
  const start = performance.now(); let step = 0, best = evaluatePersonalizer(model, validation).loss, bestWeights = Float32Array.from(initial), stale = 0;
  let bestEpoch = 0, epochsRun = 0, clippedSteps = 0, maximumObservedGradientNorm = 0;
  observeEpoch(model, { epoch: 0, validationLoss: best, selectedEpoch: bestEpoch });
  for (let epoch = 0; epoch < epochs && performance.now() - start < maxMilliseconds; epoch++) {
    let epochMaximumNorm = 0, epochClippedSteps = 0;
    // Rotate through the full training history; batch size never limits retention.
    const ordered = [...training.slice(epoch % training.length), ...training.slice(0, epoch % training.length)];
    for (let offset = 0; offset < ordered.length && performance.now() - start < maxMilliseconds;) {
      // Fold a tiny tail into the preceding batch instead of giving one final
      // gallery a full Adam update. No observations are dropped or duplicated.
      const remaining = ordered.length - offset;
      const end = remaining > batchSize && remaining < batchSize + Math.ceil(batchSize / 2) ? ordered.length : Math.min(ordered.length, offset + batchSize);
      const batch = ordered.slice(offset, end), gradient = batchGradient(model, batch);
      offset = end;
      let squaredNorm = 0;
      for (let i = outputOnly ? offsets[2] : 0; i < gradient.length; i++) {
        gradient[i] += regularization * (model.weights[i] - initial[i]);
        squaredNorm += gradient[i] * gradient[i];
      }
      const norm = Math.sqrt(squaredNorm);
      if (!Number.isFinite(norm)) throw new Error('Nonfinite gradient; candidate discarded.');
      maximumObservedGradientNorm = Math.max(maximumObservedGradientNorm, norm); epochMaximumNorm = Math.max(epochMaximumNorm, norm);
      const scale = norm > maximumGradientNorm ? maximumGradientNorm / norm : 1;
      if (scale < 1) { clippedSteps++; epochClippedSteps++; }
      step++;
      for (let i = outputOnly ? offsets[2] : 0; i < gradient.length; i++) {
        const g = gradient[i] * scale;
        // Preserve the original decimal update coefficients exactly. Computing
        // 1 - beta in binary changes Float32 rounding and can alter later steps.
        momentum[i] = beta1 * momentum[i] + .1 * g; variance[i] = beta2 * variance[i] + .001 * g * g;
        model.weights[i] -= learningRate * (momentum[i] / (1 - beta1 ** step)) / (Math.sqrt(variance[i] / (1 - beta2 ** step)) + epsilon);
      }
    }
    const validationLoss = evaluatePersonalizer(model, validation).loss;
    if (validationLoss < best - minimumImprovement) { best = validationLoss; bestWeights = Float32Array.from(model.weights); bestEpoch = epoch + 1; stale = 0; } else stale++;
    epochsRun = epoch + 1;
    const state = { epoch: epochsRun, epochs, validationLoss, selectedEpoch: bestEpoch, maximumGradientNorm: epochMaximumNorm, clippedSteps: epochClippedSteps };
    progress(state);
    observeEpoch(model, state);
    if (stale >= patience) break;
  }
  if (checkpoint === 'validation') model.weights = bestWeights;
  return { model, bestEpoch, epochsRun, steps: step, elapsedMs: performance.now() - start,
    checkpoint, maximumObservedGradientNorm, clippedSteps,
    stoppedBy: stale >= patience ? 'early-stopping' : epochsRun >= epochs ? 'epochs' : 'time-budget' };
}
export function trainImagePersonalizer(records, incumbent = null, {
  epochs = IMAGE_TRAINING_RECIPE.epochs, batchSize = IMAGE_TRAINING_RECIPE.batchSize, maxMilliseconds = IMAGE_TRAINING_RECIPE.maxMilliseconds,
  learningRate = IMAGE_TRAINING_RECIPE.learningRate, regularization = IMAGE_TRAINING_RECIPE.regularization,
  maximumGradientNorm = IMAGE_TRAINING_RECIPE.maximumGradientNorm, patience = IMAGE_TRAINING_RECIPE.patience,
  minimumImprovement = IMAGE_TRAINING_RECIPE.minimumImprovement, checkpoint = IMAGE_TRAINING_RECIPE.checkpoint,
  initialization = null, outputOnly = IMAGE_TRAINING_RECIPE.outputOnly, task = 'preference', datasetPartitions = null,
  returnCandidate = false, progress = () => {}, observeEpoch = () => {}
} = {}) {
  if (!['semantic', 'preference'].includes(task)) throw new Error('Unknown image training task.');
  if (datasetPartitions != null && task !== 'semantic') throw new Error('Explicit dataset partitions are available only for semantic training.');
  if (incumbent?.role && incumbent.role !== task) return { accepted: false, reason: 'Semantic and personal training models must remain separate.' };
  if (incumbent && !isCurrentPersonalizer(incumbent)) return { accepted: false, reason: 'Previous scoring architecture cannot initialize a current model.' };
  // Public semantic annotations never become personal taste observations. Older
  // user records had no task field and retain their original preference meaning.
  const taskRecords = records.filter(record => (record.task || 'preference') === task);
  const split = datasetPartitions == null ? splitImageDecisions(taskRecords) : semanticDatasetPartitions(taskRecords, datasetPartitions);
  const report = { version: PERSONALIZER_VERSION, task, partitionUnit: split.partitionUnit, decisions: split.decisions, meanings: split.meanings };
  if (split.train.length < 24 || split.validation.length < 8 || split.test.length < 12) return { ...report, accepted: false, reason: 'Waiting for enough independent saved choices for validation.' };
  const heldIds = new Set([...split.validation, ...split.test].map(d => d.id));
  if ([...(incumbent?.trainingDecisionIds || []), ...(incumbent?.validationDecisionIds || []), ...(incumbent?.testDecisionIds || [])].some(id => heldIds.has(id))) return { ...report, accepted: false, reason: 'Waiting for later choices unseen by the current model.' };
  let seed = initialization;
  if (task === 'preference' && seed?.role === 'semantic') seed = createPreferencePersonalizer(seed);
  if (seed?.genericValidation?.accepted === false || seed?.role && seed.role !== task) seed = null;
  let model = isCurrentPersonalizer(incumbent) ? clone(incumbent) : isCurrentPersonalizer(seed) ? clone(seed) : createPersonalizer();
  model.role = task;
  if (task === 'semantic') { delete model.semanticBase; delete model.pretrained; }
  model.weights = Float32Array.from(model.weights);
  const trainOutputOnly = outputOnly ?? (task === 'preference' && Boolean(model.pretrained));
  const recipe = { epochs, batchSize, maxMilliseconds, learningRate, regularization, maximumGradientNorm, patience, minimumImprovement, checkpoint, outputOnly: trainOutputOnly };
  let selected = null, selectedEpoch = 0, bestMatches = -1, bestSelectionLoss = Infinity;
  const fitted = fitImagePersonalizer(model, split.train, split.validation, { ...recipe, progress, observeEpoch: (current, state) => {
    // Generic galleries contain every labeled alternative; personal decisions
    // contain the shown comparisons. Rank success means all recorded orders
    // are correct (or all explicit rejections lie below their threshold).
    const validation = evaluatePersonalizer(current, split.validation);
    const matches = validation.rows.filter(row => row.accuracy >= 1 - 1e-12 && row.rejectedAboveThreshold === 0).length;
    if (matches > bestMatches || matches === bestMatches && validation.loss < bestSelectionLoss - 1e-12) {
      selected = { ...current, weights: Float32Array.from(current.weights) }; selectedEpoch = state.epoch;
      bestMatches = matches; bestSelectionLoss = validation.loss;
    }
    observeEpoch(current, { ...state, rankingSelectedEpoch: selectedEpoch });
  } });
  model = selected || fitted.model;
  Object.assign(model, { trainingRecipe: recipe, selectedEpoch, epochsRun: fitted.epochsRun,
    checkpointSelection: 'validation-ranking-then-loss', maximumObservedGradientNorm: fitted.maximumObservedGradientNorm, clippedSteps: fitted.clippedSteps });
  const result = imageModelAcceptance(model, incumbent, split.test);
  if (!result.accepted) return { ...report, ...result, ...(returnCandidate ? { candidate: { ...model, trainingDecisionIds: split.train.map(d => d.id) }, lastCandidate: fitted.model } : {}) };
  Object.assign(model, { revision: (incumbent?.revision || 0) + 1, trainedAt: new Date().toISOString(), trainingDecisionIds: split.train.map(d => d.id),
    validationDecisionIds: split.validation.map(d => d.id), testDecisionIds: split.test.map(d => d.id), personalizationMode: trainOutputOnly ? 'output-only' : 'full-head', validation: { ...result, before: { ...result.before, rows: undefined }, after: { ...result.after, rows: undefined }, baseline: { ...result.baseline, rows: undefined }, semanticBaseline: { ...result.semanticBaseline, rows: undefined } } });
  return { ...report, ...result, model, ...(returnCandidate ? { lastCandidate: fitted.model } : {}) };
}
