import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {tunedJointOutput} from '../scripts/lib/meaning-joint-tuning-inference.mjs';
import {jointMeaningOutput} from '../scripts/lib/meaning-joint-inference.mjs';
const root=new URL('../',import.meta.url),out='docs/meaning-taxonomy-training/joint-tuning/';
const bytes=p=>readFile(new URL(p,root)),json=async p=>JSON.parse(p.endsWith('.gz')?gunzipSync(await bytes(p)):await bytes(p));
const hash=b=>createHash('sha256').update(b).digest('hex');

test('joint hyperparameter refinement freezes original data and selection before retired-test checks',async()=>{
  const [p,s,r,registry]=await Promise.all([json(`${out}protocol.json`),json(`${out}selection.json`),json(`${out}report.json`),json('tests/fixtures/meaning-taxonomy/current-classifier.json')]);
  assert.equal(p.labelsChanged,false);assert.equal(p.labelPolicy,'original-v1');assert.equal(p.primaryMetric,'exactMatch');assert.equal(p.targetStrictlyGreaterThan,.9);
  assert.equal(p.sources.runner,hash(await bytes('scripts/train-meaning-joint-tuning.py')));assert.equal(p.sources.trainer,hash(await bytes('scripts/lib/meaning_joint_tuning.py')));
  assert.equal(p.datasetFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')));
  assert.equal(p.embeddingsFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/embeddings.json.gz')));
  assert.equal(s.protocolFileSha256,hash(await bytes(`${out}protocol.json`)));assert.equal(r.selectionFileSha256,hash(await bytes(`${out}selection.json`)));
  assert.equal(s.configurationCount,128);assert.equal(s.decisionFrozenBeforeTest,true);assert.equal(s.exportSeed,7919);
  assert.equal(r.testUsedForSelection,false);assert.equal(r.freshBlindConfirmation,false);assert.equal(r.registryUpdated,false);
  assert.equal(registry.artifact,p.baseline);assert.equal(s.selectedArtifactSha256,hash(await bytes(s.selectedArtifact)));
  const selected=s.finalists.find(q=>q.id===s.selectedId);assert.equal(selected.models.find(q=>q.seed===7919).artifactFileSha256,s.selectedArtifactSha256);
  if(s.selectedValidationEligible&&selected.config.family!=='ensemble')assert.equal(selected.allOptimizerFitsConverged,true);
});

test('every candidate uses fixed CV ranking calibration and group-isolated inner calibration',async()=>{
  const [p,trials,data]=await Promise.all([json(`${out}protocol.json`),json(`${out}trials.json.gz`),json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')]);
  const rows=new Map(data.items.map(r=>[r.id,r]));
  for(const run of trials){
    assert.equal(run.searchCalibration,'unary');assert.deepEqual(run.searchMetric,run.cv.unary);
    assert.equal(run.decoderFits.length,4);
    for(let fold=0;fold<4;fold++){
      const outer=p.folds[fold],fit=run.decoderFits[fold];const outerGroups=new Set(outer.validationIds.map(id=>rows.get(id).groupId));
      const monitorGroups=new Set(fit.monitorIds.map(id=>rows.get(id).groupId));
      assert(fit.monitorIds.every(id=>outer.trainIds.includes(id)&&!outerGroups.has(rows.get(id).groupId)&&rows.get(id).kind!=='paraphrase'));
      assert(fit.innerTrainIds.every(id=>outer.trainIds.includes(id)&&!outerGroups.has(rows.get(id).groupId)&&!monitorGroups.has(rows.get(id).groupId)));
      for(const [name,cal] of Object.entries(fit.calibrations))if(name!=='none')assert.equal(cal.fitRows,fit.monitorIds.length);
      if(run.config.family==='crf'&&run.config.couplingMode!=='all')assert.equal(fit.calibrations.pairwise,undefined);
    }
  }
});

test('folded heads, calibrated chains and compact ensembles reproduce Python joint distributions and confusion counts',async()=>{
  const r=await json(`${out}report.json`);const models={};
  for(const [name,record] of Object.entries(r.models)){
    assert.equal(record.artifactFileSha256,hash(await bytes(record.artifact)));models[name]=await json(record.artifact);
  }
  for(const name of ['previous-crf','previous-pcc'])models[name]=await json(r.comparators[name].artifact);
  for(const [name,folder] of [['original120','expanded-1000'],['other48','regularized-expansion']]){
    const [d,e]=await Promise.all([json(`tests/fixtures/meaning-taxonomy/${folder}/dataset.json`),json(`tests/fixtures/meaning-taxonomy/${folder}/embeddings.json.gz`)]);
    const vectors=new Map(e.rows.map(q=>[q.id,q.vector])),truth=new Map(d.items.filter(q=>q.split==='test').map(q=>[q.id,q.targets]));const cohort=r.cohorts[name];
    assert.equal(cohort.count,truth.size);
    for(const [key,artifact] of Object.entries(models)){
      let exact=0;const counts=Array.from({length:6},()=>({tp:0,fp:0,fn:0}));
      for(const [i,row] of cohort.rows.entries()){
        assert.deepEqual(row.targets,truth.get(row.id));assert(!artifact.provenance.trainIds.includes(row.id));
        const result=artifact.role==='experimental-joint-tuning'?tunedJointOutput(artifact,vectors.get(row.id)):jointMeaningOutput(artifact,vectors.get(row.id));
        assert(Math.abs(result.joint.reduce((a,b)=>a+b,0)-1)<1e-12);
        assert(result.joint.every((v,c)=>Math.abs(v-cohort.predictions[key].joint[i][c])<1e-9),`${key}/${row.id}`);
        assert(result.probabilities.every((v,c)=>Math.abs(v-cohort.predictions[key].marginals[i][c])<1e-9));
        if(result.labels.every((v,c)=>v===row.targets[c]))exact++;
        result.labels.forEach((v,c)=>{if(v&&row.targets[c])counts[c].tp++;else if(v)counts[c].fp++;else if(row.targets[c])counts[c].fn++;});
      }
      const metric=cohort.metrics[key];assert.equal(exact/cohort.count,metric.exactMatch);
      artifact.categories.forEach((c,i)=>{for(const k of ['tp','fp','fn'])assert.equal(counts[i][k],metric.perClass[c][k]);});
    }
    assert.equal(cohort.targetMet,cohort.metrics.selected.exactMatch>.9);
  }
});
