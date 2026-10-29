import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalizer, createPersonalizerScorer, personalizerScore, imageDecisions, evaluatePersonalizer, fitImagePersonalizer, trainImagePersonalizer, validPersonalizer, isCurrentPersonalizer } from '../js/services/imagePersonalizer.js';
import { gradientDiagnostic, fixedLabelBiasVariance } from '../scripts/lib/image-training-diagnostics.mjs';
import { imageChoiceHistory } from './fixtures/imageChoices.mjs';
import { readJsonFile } from '../scripts/lib/json-files.mjs';

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

test('historical bounded weights remain reproducible but cannot initialize current fusion training', async () => {
  const saved = await readJsonFile(new URL('./fixtures/image-pretraining-fp16/candidate.json.gz', import.meta.url));
  assert.equal(validPersonalizer(saved.model), true);
  assert.equal(isCurrentPersonalizer(saved.model), false);
  assert.throws(() => fitImagePersonalizer(saved.model, imageDecisions(imageChoiceHistory(4)), imageDecisions(imageChoiceHistory(4))), /current model/);
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

test('the new model is a 50/50 score fusion with no output magnitude cap', () => {
  const model = createPersonalizer(), row = imageChoiceHistory(1)[0];
  model.weights.fill(0); model.weights[model.weights.length - 1] = 20;
  const base = personalizerScore(null, row.features, row.meaningFeatures);
  assert.equal(personalizerScore(model, row.features, row.meaningFeatures), .5 * base + .5 * 20);
});

test('all three backpropagation layers agree with finite differences', () => {
  const model = createPersonalizer();
  for (let i = 49808; i < model.weights.length; i++) model.weights[i] = .05 * Math.sin(i);
  const result = gradientDiagnostic(model, imageDecisions(imageChoiceHistory(4)));
  assert.equal(result.passed, true, JSON.stringify(result));
  for (const layer of [0,1,2]) assert.ok(result.checks.some(row => row.layer === layer && Math.abs(row.analytic) > 1e-6));
});

test('a fixed scoring pass matches the guarded public score including rejected encoders', () => {
  const model = createPersonalizer(), row = imageChoiceHistory(1)[0];
  for (const candidate of [model, null, {...model, encoder: 'old-encoder'}]) {
    assert.equal(createPersonalizerScorer(candidate)(row.features, row.meaningFeatures), personalizerScore(candidate, row.features, row.meaningFeatures));
  }
});

test('the empirical Brier decomposition is additive and does not invent irreducible noise', () => {
  const result = fixedLabelBiasVariance([[.2,.7],[.4,.9]], [.5,.5]);
  assert.ok(Math.abs(result.squaredBiasToFixedLabels - .265) < 1e-12);
  assert.ok(Math.abs(result.predictionVariance - .01) < 1e-12);
  assert.ok(Math.abs(result.expectedBrierError - .275) < 1e-12);
  assert.ok(Math.abs(result.identityResidual) < 1e-12);
  assert.equal(result.irreducibleNoise, null);
  assert.throws(() => fixedLabelBiasVariance([[.2],[.4]], [.5]), /Invalid/);
});
