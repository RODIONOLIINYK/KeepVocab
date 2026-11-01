import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validMeaningCategoryClassifier, meaningCategoryProbabilities} from '../scripts/lib/meaning-category-classifier.mjs';
const root=new URL('../',import.meta.url);
const bytes=p=>readFile(new URL(p,root));
const json=async p=>JSON.parse(await bytes(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const out='docs/meaning-taxonomy-training/normalization-original/';
const fixture='tests/fixtures/meaning-taxonomy/regularized-expansion/';

test('normalization experiment freezes original labels, sources, matched pairs and three-seed choice before tests',async()=>{
  const [p,s,r,trials]=await Promise.all(['protocol','selection','report','trials'].map(n=>json(`${out}${n}.json`)));
  assert.equal(p.labelPolicy,'original-v1');assert.equal(p.labelsChanged,false);
  assert.equal(p.sourceFiles.runner,hash(await bytes('scripts/train-meaning-normalization.py')));
  assert.equal(p.sourceFiles.trainer,hash(await bytes(`${out}trainer-source.py`)));
  const implementation=await json(`${out}implementation-review.json`);
  assert.equal(implementation.trainingSourceSha256,p.sourceFiles.trainer);
  assert.equal(implementation.currentSourceSha256,hash(await bytes('scripts/lib/meaning_batchnorm.py')));
  assert.equal(implementation.allExperimentBatchPartitionsUnchanged,true);
  assert.equal(p.datasetFileSha256,hash(await bytes(`${fixture}dataset.json`)));
  assert.equal(p.embeddingsFileSha256,hash(await bytes(`${fixture}embeddings.json.gz`)));
  assert.equal(s.protocolFileSha256,hash(await bytes(`${out}protocol.json`)));
  assert.equal(r.selectionFileSha256,hash(await bytes(`${out}selection.json`)));
  assert.equal(s.decisionFrozenBeforeTest,true);assert.equal(s.testUsedForSelection,false);
  assert.equal(r.testUsedForSelection,false);assert.equal(r.freshBlindConfirmation,false);
  assert.equal(s.configurationCount,76);assert.equal(s.cvRuns,96);assert.equal(trials.length,s.cvRuns);
  assert.deepEqual(s.seeds,[7919,104729,130363]);assert.equal(s.exportSeed,7919);
  for(let pair=0;pair<30;pair++){
    const matched=trials.filter(q=>q.seed===7919&&q.config.pair===pair);
    assert.equal(matched.length,2);
    const config=q=>Object.fromEntries(Object.entries(q.config).filter(([k])=>!['batchNorm','trial'].includes(k)));
    assert.deepEqual(config(matched[0]),config(matched[1]));
    assert.notEqual(matched[0].config.batchNorm,matched[1].config.batchNorm);
  }
  for(const f of s.finalists){
    assert.deepEqual(f.models.map(q=>q.seed).sort((a,b)=>a-b),s.seeds);
    for(const m of f.models)assert.equal(m.artifactFileSha256,hash(await bytes(m.artifact)));
  }
  assert.equal(s.selectedArtifactSha256,hash(await bytes(s.selectedArtifact)));
  const chosen=s.finalists.find(q=>q.config.trial===s.selectedTrial).models.find(q=>q.seed===s.exportSeed);
  assert.equal(chosen.artifactFileSha256,s.selectedArtifactSha256);
});

test('portable folded-BN inference reproduces Python counts and probabilities for both unchanged v1 test cohorts',async()=>{
  const r=await json(`${out}report.json`);
  const locations={'retired-original-120-v1':'tests/fixtures/meaning-taxonomy/expanded-1000/', 'retired-new-48-v1':fixture};
  for(const [cohort,path] of Object.entries(locations)){
    const d=await json(`${path}dataset.json`);
    const vecs=new Map(JSON.parse(gunzipSync(await bytes(`${path}embeddings.json.gz`))).rows.map(q=>[q.id,q.vector]));
    const truth=new Map(d.items.filter(q=>q.split==='test').map(q=>[q.id,q.targets]));
    assert.equal(truth.size,r.cohorts[cohort].count);
    for(const [name,record] of Object.entries(r.models)){
      assert.equal(record.artifactFileSha256,hash(await bytes(record.artifact)));
      const model=await json(record.artifact);assert(validMeaningCategoryClassifier(model));
      let exact=0;const counts=model.categories.map(()=>({tp:0,fp:0,fn:0}));
      for(const row of r.cohorts[cohort].predictions){
        assert.deepEqual(row.targets,truth.get(row.id));assert(!model.provenance.trainIds.includes(row.id));
        const pp=meaningCategoryProbabilities(model,vecs.get(row.id));
        assert(pp.every((value,i)=>Math.abs(value-row.probabilities[name][i])<1e-10));
        const predicted=pp.map(value=>Number(value>=model.decisionThreshold));
        if(predicted.every((value,i)=>value===row.targets[i]))exact++;
        predicted.forEach((v,i)=>{if(v&&row.targets[i])counts[i].tp++;else if(v)counts[i].fp++;else if(row.targets[i])counts[i].fn++;});
      }
      const metric=r.cohorts[cohort].metrics[name];assert.equal(exact/truth.size,metric.exactMatch);
      model.categories.forEach((c,i)=>{for(const k of ['tp','fp','fn'])assert.equal(counts[i][k],metric.perClass[c][k]);});
    }
  }
});

test('outer folds and inner early-stopping monitors exclude entire meaning families and score originals only',async()=>{
  const [p,trials,d]=await Promise.all([json(`${out}protocol.json`),json(`${out}trials.json`),json(`${fixture}dataset.json`)]);
  const rows=new Map(d.items.map(q=>[q.id,q]));const all=p.trainIds;
  for(const f of p.folds){
    const tg=new Set(f.trainIds.map(id=>rows.get(id).groupId));
    assert(f.validationIds.every(id=>!tg.has(rows.get(id).groupId)));
    assert.deepEqual([...f.trainIds,...f.validationIds].sort(),[...all].sort());
  }
  for(const run of trials){
    assert.equal(run.optimizers.length,4);
    if(run.config.optimizer!=='adam')continue;
    run.optimizers.forEach((opt,i)=>{
      const fold=p.folds[i];const train=new Set(fold.trainIds);
      const outerGroups=new Set(fold.validationIds.map(id=>rows.get(id).groupId));
      for(const id of opt.innerMonitorIds){
        assert(train.has(id));assert(!outerGroups.has(rows.get(id).groupId));assert.notEqual(rows.get(id).kind,'paraphrase');
      }
      assert.equal(opt.earlyStopping,false);assert.equal(opt.innerStop.earlyStopping,true);
      assert.equal(opt.epochsExecuted,opt.innerStop.selectedEpoch);
      for(const n of [fold.trainIds.length,opt.innerTrainingRowCount]){
        assert(Math.ceil(n/run.config.batchSize)<=Math.floor(n/2));
      }
    });
  }
});

test('original-policy baseline is restored and the mixed-evidence BN candidate remains experimental',async()=>{
  const [registry,s,r]=await Promise.all([json('tests/fixtures/meaning-taxonomy/current-classifier.json'),json(`${out}selection.json`),json(`${out}report.json`)]);
  assert.equal(registry.annotationPolicyVersion,'original-v1');assert.equal(registry.artifact,s.baseline);
  assert.equal(registry.artifactFileSha256,s.baselineSha256);assert.equal(s.baselineSha256,hash(await bytes(s.baseline)));
  assert.equal(registry.restoration.experimentalCandidatePromoted,false);assert.equal(registry.productionPersonalizerChanged,false);
  assert.equal(r.registryUpdated,false);assert.equal(r.freshIndependentConfirmationRequired,true);
  assert.equal(s.matchedBatchNorm.batchNormF1Wins,1);assert(s.matchedBatchNorm.meanF1Delta<0);
  assert(s.selectedCVDeltaMacroF1<0);
  assert.equal(r.cohorts['retired-original-120-v1'].metrics.previous72_5.exactMatch,.725);
  assert.equal(r.cohorts['retired-new-48-v1'].selectedRegressionGate.checks.perClassF1,false);
});
