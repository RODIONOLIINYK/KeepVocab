import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {experimentalMeaningProbabilities} from '../scripts/lib/meaning-architecture-inference.mjs';
import {meaningCategoryProbabilities} from '../scripts/lib/meaning-category-classifier.mjs';
const root=new URL('../',import.meta.url),out='docs/meaning-taxonomy-training/exact-accuracy-search/';
const bytes=p=>readFile(new URL(p,root));
const json=async p=>JSON.parse(p.endsWith('.gz')?gunzipSync(await bytes(p)):await bytes(p));
const hash=b=>createHash('sha256').update(b).digest('hex');

test('exact-accuracy search binds unchanged original labels, 204 configurations and frozen selection',async()=>{
  const [p,s,r,registry]=await Promise.all([json(`${out}protocol.json`),json(`${out}selection.json`),json(`${out}report.json`),json('tests/fixtures/meaning-taxonomy/current-classifier.json')]);
  assert.equal(p.primaryMetric,'exactMatch');assert.equal(p.targetStrictlyGreaterThan,.9);assert.equal(p.labelsChanged,false);
  assert.equal(p.labelPolicy,'original-v1');assert.equal(p.dropout,false);assert.equal(p.batchNorm,false);
  assert.equal(p.sources.runner,hash(await bytes('scripts/train-meaning-exact-search.py')));
  assert.equal(p.sources.trainer,hash(await bytes('scripts/lib/meaning_architectures.py')));
  assert.equal(p.datasetFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')));
  assert.equal(p.embeddingsFileSha256,hash(await bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/embeddings.json.gz')));
  assert.equal(s.protocolFileSha256,hash(await bytes(`${out}protocol.json`)));
  assert.equal(r.selectionFileSha256,hash(await bytes(`${out}selection.json`)));
  assert.equal(s.configurationCount,204);assert.equal(s.decisionFrozenBeforeTest,true);assert.equal(s.testUsedForSelection,false);
  assert.equal(r.testUsedForSelection,false);assert.equal(r.freshBlindConfirmation,false);assert.equal(r.registryUpdated,false);
  assert.equal(registry.artifact,p.baseline);assert.equal(registry.artifactFileSha256,p.baselineSha256);
  assert.equal(s.selectedArtifactSha256,hash(await bytes(s.selectedArtifact)));
  assert.deepEqual(s.seeds,[7919,104729,130363]);assert.equal(s.exportSeed,7919);
  const chosen=s.finalists.find(q=>q.id===s.selectedId);const fixed=chosen.models.find(q=>q.seed===7919);
  assert.equal(fixed.artifactFileSha256,s.selectedArtifactSha256);
  assert.equal(s.validationTargetMet,s.selectedValidationMean.exactMatch>.9);
  assert.equal(s.cvTargetMet,s.selectedCVMean.exactMatch>.9);
});

test('all experimental families reproduce Python probabilities and unchanged-gold confusion counts in JavaScript',async()=>{
  const r=await json(`${out}report.json`);
  const locations={'retired-original-120-v1':'tests/fixtures/meaning-taxonomy/expanded-1000/','retired-new-48-v1':'tests/fixtures/meaning-taxonomy/regularized-expansion/'};
  const models=Object.fromEntries(await Promise.all(Object.entries(r.models).map(async([name,record])=>{
    assert.equal(record.artifactFileSha256,hash(await bytes(record.artifact)));return[name,await json(record.artifact)];
  })));
  for(const [k,path] of Object.entries(r.frozenComparators))models[k]=await json(path);
  for(const [name,path] of Object.entries(locations)){
    const d=await json(`${path}dataset.json`),e=await json(`${path}embeddings.json.gz`);
    const vectors=new Map(e.rows.map(q=>[q.id,q.vector]));const truth=new Map(d.items.filter(q=>q.split==='test').map(q=>[q.id,q.targets]));
    const c=r.cohorts[name];assert.equal(c.count,truth.size);
    for(const [key,model] of Object.entries(models)){
      const counts=Array.from({length:6},()=>({tp:0,fp:0,fn:0}));let exact=0;
      const experimental=model.role==='experimental-meaning-architecture';const th=experimental?model.thresholds:Array(6).fill(model.decisionThreshold);
      for(const row of c.predictions){
        assert.deepEqual(row.targets,truth.get(row.id));assert(!model.provenance.trainIds.includes(row.id));
        const p=experimental?experimentalMeaningProbabilities(model,vectors.get(row.id)):meaningCategoryProbabilities(model,vectors.get(row.id));
        assert(p.every((v,i)=>Math.abs(v-row.probabilities[key][i])<1e-9),`${key}/${row.word}`);
        const labels=p.map((v,i)=>Number(v>=th[i]));if(labels.every((v,i)=>v===row.targets[i]))exact++;
        labels.forEach((v,i)=>{if(v&&row.targets[i])counts[i].tp++;else if(v)counts[i].fp++;else if(row.targets[i])counts[i].fn++;});
      }
      const metric=c.metrics[key];assert.equal(exact/c.count,metric.exactMatch);
      model.categories.forEach((cat,i)=>{for(const field of ['tp','fp','fn'])assert.equal(counts[i][field],metric.perClass[cat][field]);});
    }
    assert.equal(c.selectedTargetMet,c.metrics.selected.exactMatch>.9);
  }
});

test('CV calibration and decoding fit inner groups and never outer-fold labels',async()=>{
  const [p,oof,d,trials]=await Promise.all([json(`${out}protocol.json`),json(`${out}oof-predictions.json.gz`),json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json'),json(`${out}trials.json.gz`)]);
  const rows=new Map(d.items.map(q=>[q.id,q]));assert.equal(oof.runs.length,trials.length);
  for(const run of oof.runs){
    assert.equal(run.foldDecoderData.length,4);const covered=[];
    for(let i=0;i<4;i++){
      const f=p.folds[i],inner=run.foldDecoderData[i];const outerGroups=new Set(f.validationIds.map(id=>rows.get(id).groupId));
      const monitorGroups=new Set(inner.ids.map(id=>rows.get(id).groupId));const trainGroups=new Set(inner.trainingIds.map(id=>rows.get(id).groupId));
      assert(inner.ids.every(id=>f.trainIds.includes(id)&&!outerGroups.has(rows.get(id).groupId)&&rows.get(id).kind!=='paraphrase'));
      assert([...trainGroups].every(g=>!monitorGroups.has(g)&&!outerGroups.has(g)));
      assert.deepEqual(inner.targets,inner.ids.map(id=>rows.get(id).targets));
      assert(inner.outerIndices.every(ix=>f.validationIds.includes(oof.ids[ix])));covered.push(...inner.outerIndices);
    }
    assert.deepEqual(covered.sort((a,b)=>a-b),oof.ids.map((_,i)=>i));
  }
});

test('experimental inference rejects invalid inputs and preserves six marginals',async()=>{
  const s=await json(`${out}selection.json`);const model=await json(s.selectedArtifact);
  assert.throws(()=>experimentalMeaningProbabilities(model,[0]),/Invalid/);
  const p=experimentalMeaningProbabilities(model,Array(512).fill(0));
  assert.equal(p.length,6);assert(p.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
});
