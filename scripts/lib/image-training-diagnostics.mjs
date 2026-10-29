import { createPersonalizerScorer, personalizerLossAndGradient, personalizerActivationSignature, evaluatePersonalizer, PERSONALIZER_LIMIT, PERSONALIZER_VERSION, LEGACY_PERSONALIZER_VERSION, isCurrentPersonalizer } from '../../js/services/imagePersonalizer.js';
import { decodeFeatures, sigmoid } from '../../js/services/imagePreferences.js';

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Gallery-weighted loss and Brier error: one decision, not one pair, is a unit. */
export function trainingMetrics(model, decisions, cases, { predictions = false, rows = false, branch = 'fused' } = {}) {
  if (!['fused', 'mlp', 'clip'].includes(branch) || branch === 'mlp' && !isCurrentPersonalizer(model)) throw Error('Unsupported scoring branch.');
  const fused = createPersonalizerScorer(model), base = createPersonalizerScorer(null);
  const score = branch === 'clip' ? base : branch === 'mlp' ? (features, meaning) => 2 * fused(features, meaning) - base(features, meaning) : fused;
  const details = [], probabilities = [], predictionWeights = [];
  let comparisons = 0, correctPairs = 0;
  for (const decision of decisions) {
    const item = cases.get(decision.id), pairs = decision.records.filter(row => row.kind === 'comparison');
    if (!item || !pairs.length) throw new Error('Metrics require manifest-backed comparison decisions.');
    const features = item.features, cache = new Map();
    const value = feature => { if (!cache.has(feature)) cache.set(feature, score(feature, item.meaningFeatures)); return cache.get(feature); };
    const ranked = item.candidates.map((photo, index) => ({ id: photo.id, index, score: value(features.get(photo.id)) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    let loss = 0, brier = 0, accuracy = 0;
    for (const row of pairs) {
      const difference = value(row.preferredFeatures) - value(row.features), p = sigmoid(8 * difference);
      loss -= Math.log(Math.max(1e-8, p)) / pairs.length;
      brier += (1 - p) ** 2 / pairs.length;
      accuracy += Number(difference > 0) / pairs.length;
      correctPairs += Number(difference > 0); comparisons++;
      if (predictions) { probabilities.push(p); predictionWeights.push(1 / decisions.length / pairs.length); }
    }
    details.push({ id: decision.id, meaningId: decision.meaningId, familyId: item.familyId || item.meaningId,
      pairs: pairs.length, loss, brier, accuracy, chosenAt1: Number(ranked[0].id === item.reference), topPhotoId: ranked[0].id });
  }
  const matches = details.reduce((sum, row) => sum + row.chosenAt1, 0);
  return { choices: details.length, comparisons, chosenAt1: matches, chosenAt1Rate: matches / details.length,
    rankingError: 1 - matches / details.length, loss: mean(details.map(row => row.loss)), brier: mean(details.map(row => row.brier)),
    pairwiseAccuracy: mean(details.map(row => row.accuracy)), microPairwiseAccuracy: correctPairs / comparisons,
    ...(rows ? { rows: details } : {}), ...(predictions ? { probabilities, predictionWeights } : {}) };
}

/** Optimistic lower bound imposed by the production residual/clamp, not a fitted model. */
export function residualCapacity(decisions, cases, { version = PERSONALIZER_VERSION } = {}) {
  if (version === PERSONALIZER_VERSION) return { optimisticLossLowerBound: 0, uncorrectableGalleries: 0,
    rows: decisions.map(row => ({ id: row.id, lossFloor: 0, allCorrectable: true })), note: 'Unrestricted fusion has no artificial residual-bound loss floor.' };
  if (version !== LEGACY_PERSONALIZER_VERSION) throw Error('Unsupported score architecture.');
  const base = createPersonalizerScorer(null), perDecision = [];
  for (const decision of decisions) {
    const item = cases.get(decision.id), pairs = decision.records.filter(row => row.kind === 'comparison');
    let lossFloor = 0, allCorrectable = true;
    for (const row of pairs) {
      const gap = base(row.preferredFeatures, row.meaningFeatures) - base(row.features, row.meaningFeatures);
      const maximumWinner = decodeFeatures(row.preferredFeatures)[513] < 0 ? 0 : PERSONALIZER_LIMIT;
      const bestGap = gap + maximumWinner + PERSONALIZER_LIMIT;
      lossFloor -= Math.log(Math.max(1e-8, sigmoid(bestGap * 8))) / pairs.length;
      if (bestGap <= 0) allCorrectable = false;
    }
    perDecision.push({ id: item.id, lossFloor, allCorrectable });
  }
  return { optimisticLossLowerBound: mean(perDecision.map(row => row.lossFloor)),
    uncorrectableGalleries: perDecision.filter(row => !row.allCorrectable).length, rows: perDecision };
}

/** Exact empirical squared-error identity against fixed labels, not Bayes bias/noise. */
export function fixedLabelBiasVariance(runs, weights) {
  if (runs.length < 2 || !weights.length || runs.some(xs => xs.length !== weights.length)
    || weights.some(w => !Number.isFinite(w) || w < 0) || Math.abs(weights.reduce((a,b)=>a+b,0)-1) > 1e-8
    || runs.some(xs => xs.some(p => !Number.isFinite(p) || p < 0 || p > 1))) throw new Error('Invalid bootstrap predictions or weights.');
  let squaredBiasToFixedLabels = 0, predictionVariance = 0, expectedBrierError = 0;
  for (let i = 0; i < weights.length; i++) {
    const values = runs.map(xs => xs[i]), p = mean(values);
    squaredBiasToFixedLabels += weights[i] * (1 - p) ** 2;
    predictionVariance += weights[i] * mean(values.map(value => (value - p) ** 2));
    expectedBrierError += weights[i] * mean(values.map(value => (1 - value) ** 2));
  }
  return { bootstrapModels: runs.length, comparisons: weights.length, squaredBiasToFixedLabels, predictionVariance, expectedBrierError,
    identityResidual: expectedBrierError - squaredBiasToFixedLabels - predictionVariance,
    irreducibleNoise: null,
    caveat: 'Squared bias is measured against one fixed reviewed label per pair, not the unknown Bayes probability. Irreducible label noise is not identifiable. Brier values use pair-order logistic scores, not calibrated image-suitability probabilities.' };
}

/** Finite differences at active coordinates in each layer, using real inputs. */
export function gradientDiagnostic(model, decisions, { epsilon = .0001, perLayer = 6, absoluteTolerance = .00002 } = {}) {
  const { gradient, loss } = personalizerLossAndGradient(model, decisions), checks = [], skippedBoundaries = [];
  const signature = personalizerActivationSignature(model, decisions);
  for (const [layer, start, end] of [[0, 0, 49280], [1, 49280, 49808], [2, 49808, 49825]]) {
    const indices = Array.from({ length: end - start }, (_, i) => i + start)
      .sort((a,b)=>Math.abs(gradient[b])-Math.abs(gradient[a])).slice(0,perLayer * 10);
    let tested = 0;
    for (const index of indices) {
      const original = model.weights[index];
      model.weights[index] = original + epsilon; const plusWeight = model.weights[index], plus = evaluatePersonalizer(model, decisions).loss;
      const plusSignature = personalizerActivationSignature(model, decisions);
      model.weights[index] = original - epsilon; const minusWeight = model.weights[index], minus = evaluatePersonalizer(model, decisions).loss;
      const minusSignature = personalizerActivationSignature(model, decisions);
      model.weights[index] = original;
      const numeric = (plus - minus) / (plusWeight - minusWeight), analytic = gradient[index];
      if (plusSignature !== signature || minusSignature !== signature) {
        skippedBoundaries.push({ layer, index, analytic, numeric, reason: 'Perturbation crosses a ReLU or score-clamp boundary; a central derivative is not defined across that interval.' });
        continue;
      }
      checks.push({ layer, index, analytic, numeric, absoluteError: Math.abs(analytic - numeric),
        relativeError: Math.abs(analytic - numeric) / Math.max(1e-6, Math.abs(analytic) + Math.abs(numeric)) });
      if (++tested === perLayer) break;
    }
  }
  return { loss, epsilon, absoluteTolerance, checks, skippedBoundaries,
    passed: checks.length === perLayer * 3 && checks.every(row => row.absoluteError < absoluteTolerance),
    maximumAbsoluteError: Math.max(...checks.map(row => row.absoluteError)), maximumRelativeError: Math.max(...checks.map(row => row.relativeError)) };
}
