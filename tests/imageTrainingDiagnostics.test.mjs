import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPersonalizer, createPersonalizerScorer, personalizerScore, imageDecisions, evaluatePersonalizer, fitImagePersonalizer, trainImagePersonalizer } from '../js/services/imagePersonalizer.js';
import { gradientDiagnostic, fixedLabelBiasVariance } from '../scripts/lib/image-training-diagnostics.mjs';
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

test('default fitting reproduces the pre-refactor v1.12.4 weight snapshot', () => {
  const result = trainImagePersonalizer(imageChoiceHistory(), null, { epochs: 8, returnCandidate: true, maxMilliseconds: 60000 });
  const model = result.model || result.candidate, bytes = Buffer.alloc(model.weights.length * 4);
  model.weights.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5651a8559a85346e8615d620ba12535eae43d5a6017c451c0bc73adb2fcbf03a');
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
