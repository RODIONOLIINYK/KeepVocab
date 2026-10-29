import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readJsonFile } from '../scripts/lib/json-files.mjs';
import { validatePretrainingBenchmark } from '../scripts/lib/image-pretraining-benchmark.mjs';
import { trainingMetrics, fixedLabelBiasVariance } from '../scripts/lib/image-training-diagnostics.mjs';
import { isCurrentPersonalizer } from '../js/services/imagePersonalizer.js';
import { IMAGE_TRAINING_RECIPE } from '../js/ml/imageTrainingRecipe.js';

const docs = new URL('../docs/image-fusion-v2/', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const weightsSha = model => {
  const bytes = Buffer.alloc(model.weights.length * 4);
  model.weights.forEach((value,index) => bytes.writeFloatLE(value,index*4));
  return sha(bytes);
};

test('both current fusion checkpoints reproduce all split outcomes and use the same small/full/production recipe', async () => {
  const report = await readJsonFile(new URL('training-report.json',docs));
  const small = await readJsonFile(new URL('small-batch.json',docs));
  const replay = await readJsonFile(new URL('production-replay.json',docs));
  const encoded = await readJsonFile(new URL('./fixtures/image-pretraining-fp16/embeddings.json.gz',import.meta.url));
  const manifest = await readJsonFile(new URL('./fixtures/image-pretraining-v2/cases.json',import.meta.url));
  const selected = await readJsonFile(new URL('./fixtures/image-fusion-v2/candidate.json.gz',import.meta.url));
  const last = await readJsonFile(new URL('./fixtures/image-fusion-v2/last-candidate.json.gz',import.meta.url));
  const validated = validatePretrainingBenchmark(encoded,manifest);
  assert.equal(isCurrentPersonalizer(selected.model),true);assert.equal(isCurrentPersonalizer(last.model),true);
  assert.equal(weightsSha(selected.model),report.candidateWeightsSha256);assert.equal(weightsSha(last.model),report.lastCandidateWeightsSha256);
  assert.equal(sha(JSON.stringify(IMAGE_TRAINING_RECIPE)),report.recipeSha256);
  assert.deepEqual(small.recipe,report.recipe);assert.equal(small.recipeSha256,report.recipeSha256);
  assert.equal(report.recipe.regularization,0);assert.equal(report.recipe.maximumGradientNorm,1);
  assert.equal(replay.passed,true);assert.equal(replay.selectedWeightsSha256,report.candidateWeightsSha256);assert.equal(replay.lastWeightsSha256,report.lastCandidateWeightsSha256);
  for (const split of ['train','validation','test']) {
    for (const [model,expected] of [[selected.model,report.metrics[split].fusion],[last.model,report.lastMetrics[split].fusion]]) {
      const actual=trainingMetrics(model,validated.split[split],validated.cases);
      assert.equal(actual.chosenAt1,expected.chosenAt1);assert.ok(Math.abs(actual.loss-expected.loss)<1e-12);
    }
  }
  assert.equal(report.lastMetrics.train.fusion.chosenAt1,385);assert.ok(report.lastMetrics.train.fusion.loss<.001);
  assert.equal(report.metrics.test.fusion.chosenAt1,113);assert.equal(report.lastMetrics.test.fusion.chosenAt1,111);
  assert.equal(small.passed,true);assert.equal(small.after.chosenAt1,8);assert.equal(small.after.pairwiseAccuracy,1);assert.ok(small.after.loss<.01);
  assert.equal(report.activated,false);
});

test('fusion gradient diagnostics, independent checks and both empirical decompositions agree', async () => {
  const variance=await readJsonFile(new URL('bias-variance.json',docs));
  const gradient=await readJsonFile(new URL('gradient-check.json',docs));
  const independent=await readJsonFile(new URL('independent-verification.json',docs));
  const lastIndependent=await readJsonFile(new URL('last-independent-verification.json',docs));
  assert.equal(gradient.passed,true);assert.equal(gradient.checks.length,18);assert.equal(gradient.epsilon,.001);
  assert.ok(gradient.maximumAbsoluteError<gradient.absoluteTolerance);
  for (const [data,verified] of [[variance,independent.biasVariance],[variance.lastCheckpoint,independent.lastCheckpointBiasVariance]]) {
    const actual=fixedLabelBiasVariance(data.predictionRuns,variance.predictionWeights);
    assert.equal(actual.bootstrapModels,16);assert.equal(data.irreducibleNoise,null);
    for (const key of ['squaredBiasToFixedLabels','predictionVariance','expectedBrierError']) {
      assert.ok(Math.abs(actual[key]-data[key])<1e-12);assert.ok(Math.abs(actual[key]-verified[key])<1e-12);
    }
  }
  assert.equal(independent.passed,true);assert.equal(lastIndependent.passed,true);
});
