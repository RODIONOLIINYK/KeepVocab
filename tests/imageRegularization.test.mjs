import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readJsonFile } from '../scripts/lib/json-files.mjs';
import { validatePretrainingBenchmark } from '../scripts/lib/image-pretraining-benchmark.mjs';
import { auditMeaningShiftSplit } from '../scripts/lib/image-meaning-shift.mjs';
import { trainingMetrics } from '../scripts/lib/image-training-diagnostics.mjs';
import { isCurrentPersonalizer, isValidatedSemanticModel } from '../js/services/imagePersonalizer.js';

const directory='docs/image-regularization/';
test('regularization experiment passes numerical gradients and production baseline replay',async()=>{
  const check=await readJsonFile(directory+'preflight.json');
  assert.equal(check.passed,true);assert.equal(check.evaluationDoesNotUpdateBatchNorm,true);
  assert.equal(check.kernelSha256,createHash('sha256').update(await readFile('scripts/lib/image_regularization.py')).digest('hex'));
  assert.equal(check.baselineProductionParity.gradientMaximumAbsoluteError,0);
  assert.equal(check.baselineProductionParity.oneBatch.maximumWeightError,0);
  assert.equal(check.baselineProductionParity.oneEpoch.maximumWeightError,0);
  for(const row of Object.values(check.gradients)){assert.equal(row.passed,true);assert.ok(row.maximumAbsoluteError<row.absoluteTolerance);}
});
test('true L2 excludes biases and normalization parameters; inference is batch-independent',async()=>{
  const check=await readJsonFile(directory+'invariants.json');assert.equal(check.passed,true);
  for(const row of check.checks){assert.ok(row.l2GradientMaximumError<1e-7);assert.equal(row.evaluationRunningStatsUnchanged,true);assert.ok(row.evaluationBatchIndependenceMaximumError<2e-6);}
});
test('fixed-epoch models preserve data and reproduce held-out rankings using ordinary runtime weights',async()=>{
  const report=await readJsonFile(directory+'report.json.gz'),protocol=report.protocol;
  assert.equal(report.runs.length,24);assert.equal(protocol.recipe.epochs,600);assert.equal(protocol.recipe.earlyStopping,false);
  assert.deepEqual(protocol.architecture,[1539,32,16,1]);assert.equal(report.activated,false);assert.equal(report.allRunsFrozenBeforeTest,true);
  const plan=await readJsonFile(protocol.dataSplit);
  for(const file of plan.preservation)assert.equal(createHash('sha256').update(await readFile(file.path)).digest('hex'),file.sha256);
  const validated=validatePretrainingBenchmark(await readJsonFile(plan.sourceFeatures),await readJsonFile(plan.sourceManifest));
  for(const run of report.runs){
    assert.equal(run.epochsRun,600);assert.equal(run.stoppedBy,'fixed-epochs');assert.equal(run.testEvaluated,false);
    const saved=await readJsonFile(`tests/fixtures/image-regularization/models/${run.config.name}.json.gz`);
    const split=auditMeaningShiftSplit(validated,plan,run.config.arm);
    for(const checkpoint of ['selected','last']){
      const model=saved[checkpoint].foldedModel;
      assert.equal(isCurrentPersonalizer(model),true);assert.equal(isValidatedSemanticModel(model),false);
      const actual=trainingMetrics(model,split.split.test,split.cases);
      assert.equal(actual.chosenAt1,run.metrics.test[checkpoint].chosenAt1);
    }
  }
});
test('all four variants pass the same-recipe tiny fit and independent native/folded verification',async()=>{
  const tiny=await readJsonFile(directory+'tiny.json.gz'),verify=await readJsonFile(directory+'independent-inference.json');
  assert.equal(tiny.passed,true);assert.equal(tiny.sameKernelAsFull,true);assert.equal(tiny.results.length,4);
  for(const row of tiny.results){assert.equal(row.passed,true);assert.equal(row.after.chosenAt1,8);assert.equal(row.curve.length,601);}
  assert.equal(verify.passed,true);assert.equal(verify.splitCheckpointChecks,144);
  assert.ok(verify.maximumMetricError<verify.metricTolerance);assert.ok(verify.maximumFoldScoreError<verify.foldScoreTolerance);
});
