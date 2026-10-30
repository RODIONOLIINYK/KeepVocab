import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readJsonFile} from '../scripts/lib/json-files.mjs';
import {validatePretrainingBenchmark} from '../scripts/lib/image-pretraining-benchmark.mjs';
import {auditMeaningShiftSplit} from '../scripts/lib/image-meaning-shift.mjs';
import {trainingMetrics} from '../scripts/lib/image-training-diagnostics.mjs';
import {isValidatedSemanticModel} from '../js/services/imagePersonalizer.js';
const plan=await readJsonFile('tests/fixtures/image-meaning-shift/split.json');
const validated=validatePretrainingBenchmark(await readJsonFile(plan.sourceFeatures),await readJsonFile(plan.sourceManifest));
for(const study of ['image-input-scaling','image-interaction-ablation']){
  test(`${study} preserves the source data and passes its numerical preflight`,async()=>{
    const proof=await readJsonFile(`docs/${study}/preflight.json`);assert.equal(proof.passed,true);
    for(const file of plan.preservation)assert.equal(createHash('sha256').update(await readFile(file.path)).digest('hex'),file.sha256);
    for(const row of proof.results){if(row.gradient){assert.equal(row.gradient.passed,true);assert.ok(row.gradient.maximumAbsoluteError<row.gradient.absoluteTolerance);}if(row.initialRawScoreError!==undefined)assert.ok(row.initialRawScoreError<2e-6);}
  });
  test(`${study} exported runtime weights reproduce the native held-out rankings`,async()=>{
    const report=await readJsonFile(`docs/${study}/report.json.gz`),proof=await readJsonFile(`docs/${study}/independent-inference.json`);
    assert.equal(report.runs.length,24);assert.equal(report.allRunsFrozenBeforeTest,true);assert.equal(report.activated,false);
    assert.equal(proof.passed,true);assert.equal(proof.splitCheckpointChecks,144);assert.ok(proof.maximumMetricError<proof.metricTolerance);
    for(const run of report.runs){
      assert.equal(run.epochsRun,600);assert.equal(run.stoppedBy,'fixed-epochs');assert.equal(run.testEvaluated,false);
      const saved=await readJsonFile(`tests/fixtures/${study}/models/${run.config.name}.json.gz`),audit=auditMeaningShiftSplit(validated,plan,run.config.arm);
      if(study==='image-input-scaling')assert.deepEqual(saved.normalization.fitIds,audit.split.train.map(r=>r.id));
      for(const checkpoint of ['selected','last']){
        const item=saved[checkpoint],model=item.foldedModel;assert.equal(isValidatedSemanticModel(model),false);
        if(study==='image-input-scaling'){assert.equal(item.state.inputNormalization.mean.length,1539);assert.ok(item.state.inputNormalization.scale.every(v=>Number.isFinite(v)&&v>=.001));}
        else{assert.equal(item.state.parameters.w0[0].length,1027);assert.equal(item.state.inputIndices.length,1027);for(let j=0;j<32;j++)assert.ok(model.weights.slice(j*1539+1024,j*1539+1536).every(v=>v===0));}
        assert.equal(trainingMetrics(model,audit.split.test,audit.cases).chosenAt1,run.metrics.test[checkpoint].chosenAt1);
      }
    }
  });
  test(`${study} tiny fit uses600epochs and fits all eight galleries with the full fitting kernel`,async()=>{
    const tiny=await readJsonFile(`docs/${study}/tiny.json.gz`);assert.equal(tiny.passed,true);assert.equal(tiny.sameKernelAsFull,true);assert.equal(tiny.results.length,4);
    for(const row of tiny.results){assert.equal(row.passed,true);assert.equal(row.after.chosenAt1,8);assert.equal(row.after.pairwiseAccuracy,1);assert.equal(row.curve.length,601);}
  });
}
