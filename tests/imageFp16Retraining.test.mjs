import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readJsonFile } from '../scripts/lib/json-files.mjs';
import { validatePretrainingBenchmark, validateSemanticSupervision, comparePretrainingModels } from '../scripts/lib/image-pretraining-benchmark.mjs';
import { CLIP_TAG } from '../js/ml/clipConfig.js';
import { validPersonalizer } from '../scripts/lib/image-personalizer-v2.mjs';
import { fixedLabelBiasVariance } from '../scripts/lib/image-training-diagnostics.mjs';

test('fresh FP16 features, saved candidate and all split metrics share one verified experiment', async () => {
  const root = new URL('./fixtures/image-pretraining-fp16/', import.meta.url);
  const encoded = await readJsonFile(new URL('embeddings.json.gz', root));
  const saved = await readJsonFile(new URL('candidate.json.gz', root));
  const manifest = await readJsonFile(new URL('./fixtures/image-pretraining-v2/cases.json', import.meta.url));
  const report = await readJsonFile(new URL('../docs/image-mlp-fp16/training-report.json', import.meta.url));
  assert.equal(encoded.encoder, CLIP_TAG); assert.equal(encoded.evidence, 'pixels');
  assert.equal(encoded.events.length, 2390); assert.equal(validPersonalizer(saved.model), true);
  validateSemanticSupervision(encoded, manifest);
  const validated = validatePretrainingBenchmark(encoded, manifest);
  assert.equal(createHash('sha256').update(JSON.stringify(encoded.events)).digest('hex'), report.eventsSha256);
  const bytes = Buffer.alloc(saved.model.weights.length * 4);
  saved.model.weights.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.candidateWeightsSha256);
  const measured = comparePretrainingModels(validated, saved.model, { bootstrapSamples: 10 });
  for (const split of ['train', 'validation', 'test']) for (const model of ['baseline', 'mlp']) {
    assert.equal(measured[split][model].chosenAt1, report.finalMetrics[split][model].chosenAt1);
    assert.ok(Math.abs(measured[split][model].meanPairwiseLoss - report.finalMetrics[split][model].loss) < 1e-12);
  }
  assert.equal(report.selectedEpoch, 12); assert.equal(report.epochsRun, 16);
  assert.equal(report.finalMetrics.test.baseline.chosenAt1, 113);
  assert.equal(report.finalMetrics.test.mlp.chosenAt1, 110);
  assert.equal(saved.activated, false); assert.equal(report.activated, false);
});

test('saved memorization, sampled-gradient and resampled-variance evidence is internally consistent', async () => {
  const root = new URL('../docs/image-mlp-fp16/', import.meta.url);
  const tiny = await readJsonFile(new URL('small-batch-overfit.json', root));
  const gradient = await readJsonFile(new URL('gradient-check.json', root));
  const parity = await readJsonFile(new URL('fitter-parity.json', root));
  const variance = await readJsonFile(new URL('bias-variance.json', root));
  const independent = await readJsonFile(new URL('independent-verification.json', root));
  assert.equal(tiny.passed, true); assert.equal(tiny.before.chosenAt1, 0); assert.equal(tiny.after.chosenAt1, 8);
  assert.equal(tiny.comparisons, 28); assert.equal(tiny.after.pairwiseAccuracy, 1);
  assert.ok(tiny.after.loss >= tiny.capacity.optimisticLossLowerBound - 1e-8);
  assert.ok(tiny.after.loss - tiny.capacity.optimisticLossLowerBound < .0001);
  assert.equal(gradient.passed, true); assert.equal(gradient.checks.length, 18);
  assert.equal(parity.passed, true); assert.equal(parity.changedParameters, 0);
  const recomputed = fixedLabelBiasVariance(variance.predictionRuns, variance.predictionWeights);
  assert.equal(recomputed.bootstrapModels, 24);
  for (const key of ['squaredBiasToFixedLabels', 'predictionVariance', 'expectedBrierError']) {
    assert.ok(Math.abs(recomputed[key] - variance[key]) < 1e-12);
    assert.ok(Math.abs(independent.biasVariance[key] - variance[key]) < 1e-12);
  }
  assert.equal(variance.irreducibleNoise, null); assert.equal(independent.passed, true);
});
