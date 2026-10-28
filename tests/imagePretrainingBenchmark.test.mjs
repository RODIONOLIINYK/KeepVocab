import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validatePretrainingBenchmark, comparePretrainingModels, pairedMeaningBootstrap, validateSemanticSupervision } from '../scripts/lib/image-pretraining-benchmark.mjs';
import { createPersonalizer, IMAGE_PREPROCESSING, encodeMeaning } from '../js/services/imagePersonalizer.js';
import { encodeFullFeatures, preferenceFeatures } from '../js/services/imagePreferences.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';
const vector = axis => Array.from({length:512}, (_, index) => Number(index === axis));
const features = axis => encodeFullFeatures(preferenceFeatures(vector(axis), {selected:.4, margin:.1, unwanted:.05}));
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(count = 20) {
  const cases = [], events = [];
  for (let index = 0; index < count; index++) {
    const id = `choice-${index}`, meaningId = `meaning-${index}`;
    const photos = ['preferred', 'alternative'].map(role => ({ id:`${id}-${role}`, url:`https://photos.example/${id}-${role}.jpg`, sha256:hash(`${id}-${role}`) }));
    const word = {word:`word-${index}`, definition:`The target meaning numbered ${index}.`};
    cases.push({id, meaningId, split:index < Math.floor(count * .6) ? 'train' : index < Math.floor(count * .8) ? 'validation' : 'test', word,
      candidates:index % 2 ? [...photos].reverse() : photos, feedback:{selected:[photos[0].id], wrong:[photos[1].id]}});
    events.push({id:`${id}:pair`, key:`${id}:pair`, decisionId:id, meaningId, updatedAt:new Date(Date.UTC(2026,0,index + 1)).toISOString(),
      kind:'comparison', label:0, features:features(1), preferredFeatures:features(0), meaningFeatures:encodeMeaning(vector(2)),
      encoder:CLIP_TAG, preprocessing:IMAGE_PREPROCESSING, context:{...word, imageUrl:photos[1].url, preferredUrl:photos[0].url}});
  }
  return {manifest:{kind:'synthetic-regression-only', cases}, encoded:{kind:'synthetic-regression-only', encoder:CLIP_TAG, preprocessing:IMAGE_PREPROCESSING, events}};
}

test('historical q8-vision fixtures cannot be mistaken for the corrected benchmark', async () => {
  const manifest = JSON.parse(await readFile(new URL('./fixtures/image-pretraining/cases.json', import.meta.url),'utf8'));
  const encoded = JSON.parse(await readFile(new URL('./fixtures/image-pretraining/embeddings.json', import.meta.url),'utf8'));
  assert.throws(()=>validatePretrainingBenchmark(encoded,manifest),/unsupported encoder/);
  assert.equal(manifest.cases.filter(c=>c.split==='test').every(c=>c.feedback.selected[0]===c.candidates[0].id),true,'The historical position bias remains documented.');
});

test('source IDs, hashes, URL resize aliases and meaning identities cannot overlap partitions', () => {
  for (const mutation of [
    (a,b)=>{b.id=a.id;},
    (a,b)=>{b.sha256=a.sha256;},
    (a,b)=>{b.url=a.url+'?width=256';},
    (_a,_b,manifest)=>{manifest.cases[19].meaningId=manifest.cases[0].meaningId;},
    (_a,_b,manifest)=>{manifest.cases[19].word={...manifest.cases[0].word};}
  ]) {
    const {manifest,encoded}=fixture();mutation(manifest.cases[0].candidates[0],manifest.cases[19].candidates[0],manifest);
    assert.throws(()=>validatePretrainingBenchmark(encoded,manifest),/both/);
  }
});

test('missing source metadata, missing comparisons and foreign or mislabeled events are rejected', () => {
  for (const [mutate, expected] of [
    [({manifest})=>{delete manifest.cases[0].candidates[0].sha256;},/SHA-256/],
    [({manifest})=>{delete manifest.cases[0].candidates[0].url;},/source photo URL/],
    [({encoded})=>{encoded.events.pop();},/missing encoded source photos/],
    [({encoded})=>{encoded.events[0].decisionId='foreign-case';},/does not belong/],
    [({encoded})=>{encoded.events[0].context.preferredUrl=encoded.events[0].context.imageUrl;},/preferred and alternative/],
    [({encoded})=>{encoded.events[0].meaningId='different-meaning';},/different target meaning/],
    [({encoded})=>{encoded.events[0].meaningFeatures='malformed';},/malformed/]
  ]) {
    const data=fixture();mutate(data);assert.throws(()=>validatePretrainingBenchmark(data.encoded,data.manifest),expected);
  }
});

test('declared splits must match actual training partitions instead of trusting manifest labels', () => {
  const {manifest,encoded}=fixture();
  [manifest.cases[0].split,manifest.cases[19].split]=[manifest.cases[19].split,manifest.cases[0].split];
  assert.throws(()=>validatePretrainingBenchmark(encoded,manifest),/does not match splitImageDecisions/);
});

test('a zero-output MLP exactly matches the encoded CLIP baseline, with ties reported separately', () => {
  const {manifest,encoded}=fixture(), validated=validatePretrainingBenchmark(encoded,manifest);
  const report=comparePretrainingModels(validated,createPersonalizer(),{bootstrapSamples:100});
  for (const partition of ['train','validation','test']) {
    const {baseline,mlp,pairedMeaningBootstrap:uncertainty}=report[partition];
    assert.deepEqual(mlp,baseline);
    assert.equal(mlp.tiedAt1,mlp.choices);
    assert.equal(mlp.tieAwareAgreement,.5);
    assert.equal(mlp.chosenAt1Rate,.5,'Deterministic first-choice ties depend on supplied order');
    assert.equal(mlp.pairwiseAgreement,0,'Strict pair wins do not turn score ties into successes');
    assert.ok(Math.abs(mlp.meanPairwiseLoss-Math.log(2))<1e-10);
    assert.equal(uncertainty.metrics.loss.meanDifference,0);
    assert.equal(uncertainty.metrics.loss.lower,0);assert.equal(uncertainty.metrics.loss.upper,0);
  }
});

test('paired uncertainty groups repeated comparisons by meaning and detects mismatched reports', () => {
  const before={rows:[{id:'a1',meaningId:'a',loss:1,accuracy:0,chosenAt1:0,fractionalTieCredit:0},
    {id:'a2',meaningId:'a',loss:1,accuracy:0,chosenAt1:0,fractionalTieCredit:0},
    {id:'b1',meaningId:'b',loss:1,accuracy:0,chosenAt1:0,fractionalTieCredit:0}]};
  const after={rows:before.rows.map(row=>({...row,loss:row.meaningId==='a'?0:1,accuracy:row.meaningId==='a'?1:0,chosenAt1:row.meaningId==='a'?1:0,fractionalTieCredit:row.meaningId==='a'?1:0}))};
  const report=pairedMeaningBootstrap(before,after,{bootstrapSamples:100});
  assert.equal(report.meaningCount,2);assert.equal(report.metrics.loss.meanDifference,.5,'Each meaning has one unit of weight');
  assert.equal(report.metrics.firstChoice.meanDifference,.5);
  assert.throws(()=>pairedMeaningBootstrap(before,{rows:[...after.rows].reverse()}),/ordering/);
  assert.throws(()=>pairedMeaningBootstrap(before,after,{bootstrapSamples:0}),/Positive bootstrapSamples/);
});


test('generic correctness pretraining refuses personal preference labels and ambiguous alternatives', () => {
  const {manifest,encoded}=fixture();
  assert.throws(()=>validateSemanticSupervision(encoded,manifest),/personal preferences must stay separate/);
  manifest.targetTask='semantic';encoded.events.forEach(event=>{event.task='semantic';});
  assert.doesNotThrow(()=>validateSemanticSupervision(encoded,manifest));
  encoded.events[0].task='preference';
  assert.throws(()=>validateSemanticSupervision(encoded,manifest),/personal preferences must stay separate/);
  encoded.events[0].task='semantic';manifest.cases[0].feedback.wrong=[];
  assert.throws(()=>validateSemanticSupervision(encoded,manifest),/ambiguous alternative/);
});


test('declared meaning families stay in one partition and positions remain visible per gallery', () => {
  const {manifest,encoded}=fixture();
  manifest.cases[0].familyId='shared-concept';manifest.cases[19].familyId='shared-concept';
  assert.throws(()=>validatePretrainingBenchmark(encoded,manifest),/Meaning family.*both/);
  manifest.cases[19].familyId='different-concept';
  const report=comparePretrainingModels(validatePretrainingBenchmark(encoded,manifest),createPersonalizer(),{bootstrapSamples:10});
  assert.equal(report.train.baseline.rows[0].preferredPosition,0);
  assert.equal(report.train.baseline.rows[1].preferredPosition,1);
  assert.equal(report.train.baseline.rows[0].candidateCount,2);
});


test('semantic QA exclusions preserve frozen gallery partitions instead of reshuffling later meanings', () => {
  const {manifest,encoded}=fixture();manifest.targetTask='semantic';encoded.events.forEach(event=>{event.task='semantic';});
  const expectedValidation=manifest.cases.filter(item=>item.split==='validation').map(item=>item.id);
  const expectedTest=manifest.cases.filter(item=>item.split==='test').map(item=>item.id);
  // Removing multiple entire training meanings changes the normal 60/20/20 cut.
  const excluded=new Set(manifest.cases.filter(item=>item.split==='train').slice(0,5).map(item=>item.id));
  manifest.cases=manifest.cases.filter(item=>!excluded.has(item.id));encoded.events=encoded.events.filter(event=>!excluded.has(event.decisionId));
  const validated=validatePretrainingBenchmark(encoded,manifest);
  assert.deepEqual(validated.datasetPartitions.validation,expectedValidation);
  assert.deepEqual(validated.datasetPartitions.test,expectedTest);
  assert.deepEqual(validated.split.validation.map(item=>item.id),expectedValidation);
  assert.deepEqual(validated.split.test.map(item=>item.id),expectedTest);
});


test('the fixed offline CLI writes a separate semantic candidate and complete split comparison', async t => {
  const directory=await mkdtemp(join(tmpdir(),'keepvocab-benchmark-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const {manifest,encoded}=fixture(60);manifest.targetTask='semantic';encoded.events.forEach(event=>{event.task='semantic';});
  const input=join(directory,'encoded.json'),cases=join(directory,'manifest.json'),output=join(directory,'report.json'),candidateOutput=join(directory,'candidate.json');
  await writeFile(input,JSON.stringify(encoded));await writeFile(cases,JSON.stringify(manifest));
  execFileSync(process.execPath,[new URL('../scripts/benchmark-image-personalizer.mjs',import.meta.url).pathname,input,
    '--manifest='+cases,'--output='+output,'--candidate-output='+candidateOutput],{timeout:60000,maxBuffer:2_000_000,stdio:'pipe'});
  const report=JSON.parse(await readFile(output,'utf8')),saved=JSON.parse(await readFile(candidateOutput,'utf8'));
  assert.equal(report.targetTask,'semantic');assert.equal(report.recipe.epochs,30);assert.equal(report.recipe.maxMilliseconds,120000);
  assert.equal(report.recipe.task,'semantic');assert.equal(saved.model.role,'semantic');assert.equal(saved.model.weights.length,49825);
  assert.equal(report.splits.train.baseline.choices,36);assert.equal(report.splits.validation.baseline.choices,12);assert.equal(report.splits.test.baseline.choices,12);
  assert.equal(report.recipe.datasetPartitions.test.length,12);assert.equal(report.splits.test.pairedMeaningBootstrap.unit,'meaning-family');
});

test('raw CLIP uses image–meaning cosine independently of semantic heuristics or MLP weights', () => {
  const {manifest,encoded}=fixture();
  // Image0 exactly matches meaning0. Artificial app semantic scores instead
  // favor image1, so the two reported baselines must disagree.
  for (const event of encoded.events) {
    event.meaningFeatures=encodeMeaning(vector(0));
    event.preferredFeatures=encodeFullFeatures(preferenceFeatures(vector(0),{selected:.1,margin:0,unwanted:0}));
    event.features=encodeFullFeatures(preferenceFeatures(vector(1),{selected:.8,margin:0,unwanted:0}));
  }
  const validated=validatePretrainingBenchmark(encoded,manifest),model=createPersonalizer();
  const first=comparePretrainingModels(validated,model,{bootstrapSamples:10});
  model.weights[model.weights.length-1]=1;
  const second=comparePretrainingModels(validated,model,{bootstrapSamples:10});
  for (const partition of ['train','validation','test']) {
    assert.equal(first[partition].rawClip.chosenAt1,first[partition].rawClip.choices);
    assert.equal(first[partition].rawClip.pairwiseAgreement,1);
    assert.equal(first[partition].baseline.chosenAt1,0);
    assert.equal(first[partition].baseline.pairwiseAgreement,0);
    assert.deepEqual(first[partition].rawClip,second[partition].rawClip);
    assert.ok(first[partition].rawClipVsMlpMeaningBootstrap.metrics.firstChoice.meanDifference<0);
  }
});
