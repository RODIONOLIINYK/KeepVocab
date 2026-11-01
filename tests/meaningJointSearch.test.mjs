import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {jointMeaningOutput} from '../scripts/lib/meaning-joint-inference.mjs';
const root=new URL('../',import.meta.url),out='docs/meaning-taxonomy-training/joint-label-search/';
const bytes=p=>readFile(new URL(p,root));const json=async p=>JSON.parse(p.endsWith('.gz')?gunzipSync(await bytes(p)):await bytes(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
test('joint-label research search binds original data and sources with pre-test decoder selection',async()=>{
  const [p,s,r,registry]=await Promise.all([json(`${out}protocol.json`),json(`${out}selection.json`),json(`${out}report.json`),json('tests/fixtures/meaning-taxonomy/current-classifier.json')]);
  assert.equal(p.labelsChanged,false);assert.equal(p.primaryMetric,'exactMatch');assert.equal(s.targetStrictlyGreaterThan,.9);
  assert.equal(p.sources.runner,hash(await bytes('scripts/train-meaning-joint-search.py')));assert.equal(p.sources.trainer,hash(await bytes('scripts/lib/meaning_joint.py')));
  assert.equal(p.sources.priorSelection,hash(await bytes('docs/meaning-taxonomy-training/exact-accuracy-search/selection.json')));
  assert.equal(p.datasetFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')));
  assert.equal(s.protocolFileSha256,hash(await bytes(`${out}protocol.json`)));assert.equal(r.selectionFileSha256,hash(await bytes(`${out}selection.json`)));
  assert.equal(s.configurationCount,78);assert.equal(s.decisionFrozenBeforeTest,true);assert.equal(r.testUsedForSelection,false);
  assert.equal(s.registryUpdated,false);assert.equal(r.productionActivated,false);assert.equal(registry.artifact,p.baseline);
  assert.equal(s.selectedArtifactSha256,hash(await bytes(s.selectedArtifact)));
  for(const f of s.finalists){
    assert.deepEqual(f.models.map(q=>q.seed).sort((a,b)=>a-b),[7919,104729,130363]);
    for(const q of f.models)assert.equal(q.artifactFileSha256,hash(await bytes(q.artifact)));
  }
});
test('joint/marginal probabilities and both exact decoders reproduce Python for unchanged gold cohorts',async()=>{
  const r=await json(`${out}report.json`);
  for(const [name,folder] of [['original120','expanded-1000'],['other48','regularized-expansion']]){
    const e=await json(`tests/fixtures/meaning-taxonomy/${folder}/embeddings.json.gz`),d=await json(`tests/fixtures/meaning-taxonomy/${folder}/dataset.json`);
    const vectors=new Map(e.rows.map(q=>[q.id,q.vector])),truth=new Map(d.items.filter(q=>q.split==='test').map(q=>[q.id,q.targets]));
    const cohort=r.cohorts[name];assert.equal(cohort.count,truth.size);
    for(const [key,record] of Object.entries(r.models)){
      assert.equal(record.artifactFileSha256,hash(await bytes(record.artifact)));const model=await json(record.artifact);
      for(const decoder of ['map','marginal']){
        let exact=0;const counts=Array.from({length:6},()=>({tp:0,fp:0,fn:0}));
        for(const [ix,row] of cohort.rows.entries()){
          assert.deepEqual(row.targets,truth.get(row.id));assert(!model.provenance.trainIds.includes(row.id));
          const result=jointMeaningOutput({...model,decoder},vectors.get(row.id));
          assert(Math.abs(result.joint.reduce((a,b)=>a+b,0)-1)<1e-12);
          assert(result.joint.every((v,i)=>Math.abs(v-cohort.predictions[key].joint[ix][i])<1e-9));
          assert(result.probabilities.every((v,i)=>Math.abs(v-cohort.predictions[key].marginals[ix][i])<1e-9));
          if(result.labels.every((v,i)=>v===row.targets[i]))exact++;
          result.labels.forEach((v,i)=>{if(v&&row.targets[i])counts[i].tp++;else if(v)counts[i].fp++;else if(row.targets[i])counts[i].fn++;});
        }
        const metric=cohort.metrics[key][decoder];assert.equal(exact/truth.size,metric.exactMatch);
        model.categories.forEach((c,i)=>{for(const f of ['tp','fp','fn'])assert.equal(counts[i][f],metric.perClass[c][f]);});
      }
    }
    assert.equal(cohort.targetMet,cohort.metrics.selected.chosen.exactMatch>.9);
  }
});
test('joint CV keeps parents, family weights and held-out groups separated',async()=>{
  const [p,oof,d]=await Promise.all([json(`${out}protocol.json`),json(`${out}oof-joint.json.gz`),json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')]);
  const rows=new Map(d.items.map(q=>[q.id,q]));
  assert(oof.ids.every(id=>rows.get(id).kind!=='paraphrase'));
  for(const f of p.folds){
    const train=new Set(f.trainIds.map(id=>rows.get(id).groupId));assert(f.validationIds.every(id=>!train.has(rows.get(id).groupId)));
  }
  for(const run of oof.runs){assert.equal(run.joint.length,oof.ids.length);assert(run.joint.every(row=>row.length===64&&Math.abs(row.reduce((a,b)=>a+b,0)-1)<1e-12));}
});
