import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {structuredMeaningOutput} from '../scripts/lib/meaning-structured-inference.mjs';
const root=new URL('../',import.meta.url),out='docs/meaning-taxonomy-training/structured-heads/';
const bytes=p=>readFile(new URL(p,root)),json=async p=>JSON.parse(p.endsWith('.gz')?gunzipSync(await bytes(p)):await bytes(p));
const hash=b=>createHash('sha256').update(b).digest('hex');

test('structured architecture search freezes original labels, training scope and model choice before regression tests',async()=>{
  const [p,s,r,registry]=await Promise.all([json(`${out}protocol.json`),json(`${out}selection.json`),json(`${out}report.json`),json('tests/fixtures/meaning-taxonomy/current-classifier.json')]);
  assert.equal(p.labelPolicy,'original-v1');assert.equal(p.labelsChanged,false);assert.equal(p.primaryMetric,'exactMatch');assert.equal(p.targetStrictlyGreaterThan,.9);
  assert.equal(p.sources.runner,hash(await bytes('scripts/train-meaning-structured.py')));assert.equal(p.sources.trainer,hash(await bytes('scripts/lib/meaning_structured.py')));
  assert.equal(p.datasetFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')));
  assert.equal(p.embeddingsFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/embeddings.json.gz')));
  assert.equal(s.protocolFileSha256,hash(await bytes(`${out}protocol.json`)));assert.equal(r.selectionFileSha256,hash(await bytes(`${out}selection.json`)));
  assert.equal(s.configurationCount,136);assert.equal(s.decisionFrozenBeforeTest,true);assert.equal(s.exportSeed,7919);
  assert.equal(r.testUsedForSelection,false);assert.equal(r.freshBlindConfirmation,false);assert.equal(r.registryUpdated,false);assert.equal(registry.artifact,p.reference);
  assert.equal(s.selectedArtifactSha256,hash(await bytes(s.selectedArtifact)));
  const controls=s.finalists.filter(q=>q.config.capacitySweep);assert.equal(controls.length,10);
  for(const q of controls){assert.deepEqual(q.models.map(z=>z.seed),s.seeds);assert.equal(q.config.activation,'tanh');assert.equal(q.config.learningRate,.003);assert.equal(q.config.batchSize,64);}
  for(const q of s.finalists)for(const fit of q.models){
    assert.equal(fit.artifactFileSha256,hash(await bytes(fit.artifact)));const a=await json(fit.artifact);
    assert.deepEqual(a.provenance.trainIds,p.trainIds);assert.equal(a.provenance.testUsedForSelection,false);
  }
});

test('all architecture CV preprocessing, epoch selection and calibration keep source families isolated',async()=>{
  const [p,trials,data]=await Promise.all([json(`${out}protocol.json`),json(`${out}trials.json.gz`),json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')]);
  const rows=new Map(data.items.map(q=>[q.id,q]));
  for(const run of trials){assert.equal(run.decoderFits.length,4);
    for(let fold=0;fold<4;fold++){
      const outer=p.folds[fold],fit=run.decoderFits[fold],outerGroups=new Set(outer.validationIds.map(id=>rows.get(id).groupId));
      const monitorGroups=new Set(fit.ids.map(id=>rows.get(id).groupId));
      assert(fit.ids.every(id=>outer.trainIds.includes(id)&&!outerGroups.has(rows.get(id).groupId)&&rows.get(id).kind!=='paraphrase'));
      assert(fit.trainingIds.every(id=>outer.trainIds.includes(id)&&!outerGroups.has(rows.get(id).groupId)&&!monitorGroups.has(rows.get(id).groupId)));
      assert.equal(fit.calibration.method,run.config.family==='svm'?'none':'unary');
      if(run.config.family==='svm')assert.equal(fit.svmPlatt.fitRows,fit.ids.length);else assert.equal(fit.calibration.fitRows,fit.ids.length);
    }
  }
});

test('independent JavaScript inference reproduces all reported joint distributions, marginals and class errors',async()=>{
  const report=await json(`${out}report.json`),models={};
  for(const [key,q] of Object.entries(report.models)){assert.equal(q.artifactFileSha256,hash(await bytes(q.artifact)));models[key]=await json(q.artifact);}
  for(const [name,folder] of [['original120','expanded-1000'],['other48','regularized-expansion']]){
    const [d,e]=await Promise.all([json(`tests/fixtures/meaning-taxonomy/${folder}/dataset.json`),json(`tests/fixtures/meaning-taxonomy/${folder}/embeddings.json.gz`)]);
    const vectors=new Map(e.rows.map(q=>[q.id,q.vector])),truth=new Map(d.items.filter(q=>q.split==='test').map(q=>[q.id,q.targets])),c=report.cohorts[name];assert.equal(c.count,truth.size);
    for(const [key,a] of Object.entries(models)){
      let exact=0;const counts=Array.from({length:6},()=>({tp:0,fp:0,fn:0}));
      for(const [i,row] of c.rows.entries()){
        assert.deepEqual(row.targets,truth.get(row.id));assert(!a.provenance.trainIds.includes(row.id));const result=structuredMeaningOutput(a,vectors.get(row.id));
        assert(Math.abs(result.joint.reduce((a,b)=>a+b,0)-1)<1e-12);
        assert(result.joint.every((v,k)=>Math.abs(v-c.predictions[key].joint[i][k])<1e-8),`${key}/${row.id}`);
        assert(result.probabilities.every((v,k)=>Math.abs(v-c.predictions[key].marginals[i][k])<1e-8));
        if(result.labels.every((v,k)=>v===row.targets[k]))exact++;
        result.labels.forEach((v,k)=>{if(v&&row.targets[k])counts[k].tp++;else if(v)counts[k].fp++;else if(row.targets[k])counts[k].fn++;});
      }
      assert.equal(exact/c.count,c.metrics[key].exactMatch);a.categories.forEach((label,k)=>{for(const z of ['tp','fp','fn'])assert.equal(counts[k][z],c.metrics[key].perClass[label][z]);});
    }
    assert.equal(c.targetMet,c.metrics.selected.exactMatch>.9);
  }
});

test('training curves observe a parity-verified frozen fit and never use test rows or select stopping from validation',async()=>{
  const [curve,s,p,data]=await Promise.all([json(`${out}curves.json`),json(`${out}selection.json`),json(`${out}protocol.json`),json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')]);
  assert.equal(curve.selectionFileSha256,hash(await bytes(`${out}selection.json`)));assert.equal(curve.curveModelId,s.bestNeuralCurveId);
  assert.equal(curve.artifactFileSha256,hash(await bytes(curve.artifact)));assert.equal(curve.parameterParityPassed,true);assert.equal(curve.testUsed,false);assert.equal(curve.validationUsedForStopping,false);
  assert(Math.max(...Object.values(curve.maxAbsoluteParameterDifference))<1e-10);
  assert.deepEqual(curve.trainIds,p.trainIds);assert.deepEqual(curve.validationIds,p.validationIds);
  const tests=new Set(data.items.filter(q=>q.split==='test').map(q=>q.id));assert([...curve.trainIds,...curve.validationIds].every(id=>!tests.has(id)));
  assert.equal(curve.trace.length,curve.epochs+1);assert.equal(curve.trace[0].step,0);assert.equal(curve.trace.at(-1).step,curve.epochs);
  assert(curve.trace.every(q=>q.trainingOriginalCount===750&&q.monitorCount===48));assert.equal(curve.capacityControls.length,10);
  assert.throws(()=>structuredMeaningOutput({},Array(512).fill(0)),/Invalid/);
});

test('double-descent diagnostics cross the requested capacity range with fixed budgets and no test-based selection',async()=>{
  const dir=`${out}double-descent/`,[p,r,summary]=await Promise.all([json(`${dir}protocol.json`),json(`${dir}results.json.gz`),json(`${dir}summary.json`)]);
  assert.equal(p.sources.runner,hash(await bytes('scripts/train-meaning-double-descent.py')));assert.equal(p.sources.trainer,hash(await bytes('scripts/lib/meaning_structured.py')));
  assert.equal(r.protocolFileSha256,hash(await bytes(`${dir}protocol.json`)));assert.equal(summary.resultsFileSha256,hash(await bytes(`${dir}results.json.gz`)));
  assert.equal(p.testUsed,false);assert.equal(r.testUsed,false);assert.equal(r.usedForModelSelection,false);assert.equal(p.reusedValidation,true);
  assert.equal(p.originalTrainingMeanings,750);assert.equal(p.trainingRows,890);assert.equal(r.runs.length,66);assert.equal(summary.summary.length,22);
  const keys=new Set();
  for(const q of r.runs){
    keys.add(`${q.width}/${q.l2}/${q.seed}`);assert.equal(q.parameterCount,519*q.width+21);assert.equal(q.epochs,p.epochs);
    assert.equal(q.parametersPerOriginalMeaning,q.parameterCount/750);assert.equal(q.parametersPerTrainingRow,q.parameterCount/890);
    assert.equal(q.trace[0].epoch,0);assert.equal(q.trace.at(-1).epoch,p.epochs);assert.equal(q.trainingInterpolated,q.trace.at(-1).allTrainingRowsExact===1);
    assert(q.trace.every(z=>Number.isFinite(z.validation.jointNLL)&&Number.isFinite(z.train.jointNLL)));
    if(q.diagnosticArtifact)assert.equal(q.diagnosticArtifactFileSha256,hash(await bytes(q.diagnosticArtifact)));
  }
  assert.equal(keys.size,66);assert(r.runs.some(q=>q.parametersPerOriginalMeaning>=10&&q.parametersPerOriginalMeaning<12));
  assert(r.runs.some(q=>q.parameterCount>500000));
});

test('all-zero initialization control verifies the hidden-path invariant without changing the capacity experiment',async()=>{
  const a=await json(`${out}zero-initialization.json`);
  assert.equal(a.sourceSha256,hash(await bytes('scripts/check-meaning-zero-init.py')));assert.equal(a.trainerSha256,hash(await bytes('scripts/lib/meaning_structured.py')));
  assert.equal(a.testUsed,false);assert.equal(a.usedForModelSelection,false);assert.equal(a.labelChanges,false);assert.equal(a.runs.length,9);
  for(const q of a.runs){assert.equal(q.allHiddenAndOutputWeightGradientsZero,true);assert.equal(q.inputLogProbabilityVariation,0);assert.equal(q.validationInputLogProbabilityVariation,0);
    assert(q.nonMatrixParameterMaxChange>0);assert(q.randomHiddenZeroOutputControl.firstOutputWeightGradientMax>0);
    assert.equal(q.randomHiddenZeroOutputControl.firstHiddenWeightGradientMax,0);assert(q.randomHiddenZeroOutputControl.secondHiddenWeightGradientMax>0);
  }
});
