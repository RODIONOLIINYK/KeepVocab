import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalizer, createPersonalizerScorer, personalizerScore, personalizerLossAndGradient, imageDecisions, evaluatePersonalizer, fitImagePersonalizer, trainImagePersonalizer, validPersonalizer, isCurrentPersonalizer, LEGACY_PERSONALIZER_VERSION } from '../js/services/imagePersonalizer.js';
import { imageChoiceHistory } from './fixtures/imageChoices.mjs';

test('the shared fitting core memorizes a tiny batch without weakening production acceptance', () => {
  const history = imageChoiceHistory(4), decisions = imageDecisions(history), initial = createPersonalizer(), before = Float32Array.from(initial.weights);
  const seen = [];
  const result = fitImagePersonalizer(initial, decisions, decisions, { epochs: 60, batchSize: 4, regularization: 0,
    patience: Infinity, maxMilliseconds: 10000, observeEpoch: (_model, row) => seen.push(row.epoch) });
  assert.deepEqual(initial.weights, before, 'diagnostics do not mutate the supplied initialization');
  assert.equal(evaluatePersonalizer(result.model, decisions).accuracy, 1);
  assert.ok(evaluatePersonalizer(result.model, decisions).loss < .6);
  assert.equal(result.epochsRun, 60);
  assert.equal(seen.length, 61);
  assert.equal(trainImagePersonalizer(history).accepted, false, 'a memorization run cannot activate a production head');
});

test('retired bounded weights cannot initialize current fusion training', () => {
  const retired = { ...createPersonalizer(), version: LEGACY_PERSONALIZER_VERSION };
  assert.equal(validPersonalizer(retired), false);
  assert.equal(isCurrentPersonalizer(retired), false);
  assert.throws(() => fitImagePersonalizer(retired, imageDecisions(imageChoiceHistory(4)), imageDecisions(imageChoiceHistory(4))), /current model/);
});

test('global norm clipping records clipping and merges a tiny final batch without discarding records', () => {
  const decisions = imageDecisions(imageChoiceHistory(17)), epochs = [];
  const result = fitImagePersonalizer(createPersonalizer(), decisions, decisions, { epochs: 1, batchSize: 8, regularization: 0,
    maximumGradientNorm: .000001, checkpoint: 'last', observeEpoch: (_model, row) => epochs.push(row) });
  assert.equal(result.steps, 2, 'eight galleries then nine; no one-gallery tail update');
  assert.ok(result.maximumObservedGradientNorm > .000001);
  assert.ok(result.clippedSteps > 0); assert.ok(epochs.at(-1).clippedSteps > 0);
  assert.ok(result.model.weights.every(Number.isFinite));
});

test('the personal head has an unrestricted score independent of the CLIP filtering score', () => {
  const model = createPersonalizer(), row = imageChoiceHistory(1)[0];
  model.weights.fill(0); model.weights[model.weights.length - 1] = 20;
  assert.equal(personalizerScore(model, row.features, row.meaningFeatures), 20);
});

test('backpropagation gradient matches finite differences across layers', () => {
  const model = createPersonalizer(), decisions = imageDecisions(imageChoiceHistory(4)), eps = 1e-3;
  for (let i = model.weights.length - 17; i < model.weights.length; i++) model.weights[i] = .05 * Math.sin(i);
  const { gradient } = personalizerLossAndGradient(model, decisions, 0);
  const probe = [0, 32, model.weights.length - 20, model.weights.length - 2, model.weights.length - 1];
  for (const index of probe) {
    const plus = Float32Array.from(model.weights), minus = Float32Array.from(model.weights);
    plus[index] += eps; minus[index] -= eps;
    const numeric = (personalizerLossAndGradient({ ...model, weights: plus }, decisions, 0).loss
      - personalizerLossAndGradient({ ...model, weights: minus }, decisions, 0).loss) / (2 * eps);
    assert.ok(Math.abs(gradient[index] - numeric) < 1e-3, `index ${index}: analytic=${gradient[index]} numeric=${numeric}`);
  }
});

test('a fixed scoring pass matches the guarded public score including rejected encoders', () => {
  const model = createPersonalizer(), row = imageChoiceHistory(1)[0];
  for (const candidate of [model, null, {...model, encoder: 'old-encoder'}]) {
    assert.equal(createPersonalizerScorer(candidate)(row.features, row.meaningFeatures), personalizerScore(candidate, row.features, row.meaningFeatures));
  }
});
