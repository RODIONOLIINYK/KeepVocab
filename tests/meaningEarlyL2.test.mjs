import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {structuredMeaningOutput} from '../scripts/lib/meaning-structured-inference.mjs';
const root=new URL('../',import.meta.url),out='docs/meaning-taxonomy-training/early-l2/';
const bytes=p=>readFile(new URL(p,root)),json=async p=>JSON.parse(p.endsWith('.gz')?gunzipSync(await bytes(p)):await bytes(p));
const hash=b=>createHash('sha256').update(b).digest('hex');

test('early stopping plus L2 selection freezes labels, positive regularization and checkpoints before regression checks',async()=>{
  const [p,s,c,r,registry]=await Promise.all([json(`${out}protocol.json`),json(`${out}selection.json`),json(`${out}controls.json`),json(`${out}report.json`),json('tests/fixtures/meaning-taxonomy/current-classifier.json')]);
  assert.equal(p.sources.runner,hash(await bytes('scripts/train-meaning-early-l2.py')));assert.equal(p.sources.trainer,hash(await bytes('scripts/lib/meaning_structured.py')));
  assert.equal(p.datasetFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')));
  assert.equal(p.embeddingsFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/embeddings.json.gz')));
  assert.equal(p.labelsChanged,false);assert.equal(p.labelPolicy,'original-v1');assert.equal(s.primaryMetric,'exactMatch');assert.equal(s.configurationCount,27);assert.equal(s.cvRuns,54);
  assert.equal(s.protocolFileSha256,hash(await bytes(`${out}protocol.json`)));assert.equal(r.selectionFileSha256,hash(await bytes(`${out}selection.json`)));assert.equal(r.controlsFileSha256,hash(await bytes(`${out}controls.json`)));
  assert.equal(s.decisionFrozenBeforeTest,true);assert.equal(r.testUsedForSelection,false);assert.equal(r.freshBlindConfirmation,false);assert.equal(r.registryUpdated,false);assert.equal(registry.artifact,p.reference);
  assert.equal(s.selectedArtifactSha256,hash(await bytes(s.selectedArtifact)));const a=await json(s.selectedArtifact);
  assert(a.configuration.l2>0);assert.equal(a.configuration.l2,a.configuration.pairL2);assert.equal(a.calibration.method,'none');assert.equal(a.fitPartition.restoredBestCheckpoint,true);assert.equal(a.fitPartition.refittedOnMonitor,false);
  assert.equal(a.model.optimizer.earlyStopping,true);assert.equal(c.usedForSelection,false);assert.equal(c.testUsed,false);
});

test('all stopping monitors remain group-isolated from fitting and from each outer holdout',async()=>{
  const [p,trials,data]=await Promise.all([json(`${out}protocol.json`),json(`${out}trials.json.gz`),json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')]);
  const rows=new Map(data.items.map(q=>[q.id,q]));
  for(const run of trials){assert.equal(run.fits.length,4);
    for(let fold=0;fold<4;fold++){
      const outer=p.folds[fold],{partition:f,optimizer:o}=run.fits[fold],held=new Set(outer.validationIds.map(id=>rows.get(id).groupId)),stop=new Set(f.stoppingIds.map(id=>rows.get(id).groupId));
      assert(f.trainIds.every(id=>outer.trainIds.includes(id)&&!held.has(rows.get(id).groupId)&&!stop.has(rows.get(id).groupId)));
      assert(f.stoppingIds.every(id=>outer.trainIds.includes(id)&&!held.has(rows.get(id).groupId)&&rows.get(id).kind!=='paraphrase'));
      assert.equal(f.refittedOnMonitor,false);assert(o.selectedEpoch<=o.epochsExecuted);assert(o.epochsExecuted>=30);assert.equal(o.earlyStopping,true);
      let loss=Infinity,chosen=0;for(const point of o.monitorTrace)if(point.monitorJointNLL<loss-.0001){loss=point.monitorJointNLL;chosen=point.step;}
      assert.equal(o.selectedEpoch,chosen);
    }
  }
});

test('four ablations use the same fitting rows, monitor reservation and fixed seeds',async()=>{
  const c=await json(`${out}controls.json`);assert.deepEqual(Object.keys(c.conditions),['neither','l2-only','early-only','early-and-l2']);
  for(const seed of [7919,104729,130363]){
    const base=c.conditions.neither.models.find(q=>q.seed===seed);
    for(const [name,condition] of Object.entries(c.conditions)){
      const fit=condition.models.find(q=>q.seed===seed);assert.equal(fit.artifactFileSha256,hash(await bytes(fit.artifact)));const a=await json(fit.artifact);
      assert.deepEqual(fit.partition.trainIds,base.partition.trainIds);assert.deepEqual(fit.partition.reservedMonitorIds,base.partition.reservedMonitorIds);
      assert.equal(a.model.optimizer.earlyStopping,condition.earlyStopping);assert.equal(a.configuration.l2,condition.l2);
      if(!condition.earlyStopping){assert.equal(a.model.optimizer.selectedEpoch,1000);assert.deepEqual(fit.partition.stoppingIds,[]);}
    }
  }
});

test('independent inference reproduces checkpoint and matched-control probabilities and per-class counts',async()=>{
  const r=await json(`${out}report.json`),models={};
  for(const [name,q] of Object.entries(r.models)){assert.equal(q.artifactFileSha256,hash(await bytes(q.artifact)));models[name]=await json(q.artifact);}
  for(const [name,folder] of [['original120','expanded-1000'],['other48','regularized-expansion']]){
    const [data,embedded]=await Promise.all([json(`tests/fixtures/meaning-taxonomy/${folder}/dataset.json`),json(`tests/fixtures/meaning-taxonomy/${folder}/embeddings.json.gz`)]);
    const vectors=new Map(embedded.rows.map(q=>[q.id,q.vector])),truth=new Map(data.items.filter(q=>q.split==='test').map(q=>[q.id,q.targets])),cohort=r.cohorts[name];assert.equal(cohort.count,truth.size);
    for(const [key,a] of Object.entries(models)){
      const used=new Set([...a.provenance.trainIds,...(a.provenance.stoppingIds||[])]);let exact=0;const counts=Array.from({length:6},()=>({tp:0,fp:0,fn:0}));
      for(const [i,row] of cohort.rows.entries()){
        assert(!used.has(row.id));assert.deepEqual(row.targets,truth.get(row.id));const result=structuredMeaningOutput(a,vectors.get(row.id));
        assert(result.joint.every((v,k)=>Math.abs(v-cohort.predictions[key].joint[i][k])<1e-8),`${key}/${row.id}`);
        assert(result.probabilities.every((v,k)=>Math.abs(v-cohort.predictions[key].marginals[i][k])<1e-8));if(result.labels.every((v,k)=>v===row.targets[k]))exact++;
        result.labels.forEach((v,k)=>{if(v&&row.targets[k])counts[k].tp++;else if(v)counts[k].fp++;else if(row.targets[k])counts[k].fn++;});
      }
      assert.equal(exact/cohort.count,cohort.metrics[key].exactMatch);a.categories.forEach((label,k)=>{for(const stat of ['tp','fp','fn'])assert.equal(counts[k][stat],cohort.metrics[key].perClass[label][stat]);});
    }
  }
});

test('curve replay matches restored weights exactly and never chooses epochs using validation or test',async()=>{
  const [s,c,p]=await Promise.all([json(`${out}selection.json`),json(`${out}curves.json`),json(`${out}protocol.json`)]);
  assert.equal(c.selectionFileSha256,hash(await bytes(`${out}selection.json`)));assert.equal(c.artifactFileSha256,s.selectedArtifactSha256);assert.equal(c.selectedId,s.selectedId);
  assert.equal(c.parameterParityPassed,true);assert.equal(Math.max(...Object.values(c.parameterMaxAbsoluteErrors)),0);assert.equal(c.validationUsedForStopping,false);assert.equal(c.testUsed,false);
  assert.equal(c.checkpointRestored,true);assert.equal(c.refitOnMonitor,false);assert.equal(c.trace.length,c.executedEpochs+1);assert(c.selectedEpoch<=c.executedEpochs);
  const a=await json(s.selectedArtifact);assert.deepEqual(c.trainIds,a.provenance.trainIds);assert.deepEqual(c.stoppingIds,a.provenance.stoppingIds);assert.deepEqual(c.validationIds,p.validationIds);
  assert(c.trace.every(q=>q.trainingOriginalCount===c.trainingOriginalCount&&q.monitorCount===48));
});
