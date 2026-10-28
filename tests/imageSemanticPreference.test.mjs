import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonalizer, createPreferencePersonalizer, isValidatedSemanticModel, personalizerScore, trainImagePersonalizer, imageModelAcceptance, splitImageDecisions, semanticDatasetPartitions, PERSONAL_PREFERENCE_LIMIT } from '../js/services/imagePersonalizer.js';
import { ImagePersonalizerTraining } from '../js/services/imagePersonalizerTraining.js';
import { imageChoiceHistory } from './fixtures/imageChoices.mjs';

function semanticSeed() {
  const model=createPersonalizer(); model.role='semantic'; model.weights[model.weights.length-1]=.2;
  model.genericValidation={accepted:true,dataset:'controlled-semantic-fixture'};
  return model;
}
function persistence(records=imageChoiceHistory()) {
  let model=null;
  return {imageHistory:{ready:Promise.resolve(),resetAt:'',model:async()=>model,saveModel:async value=>{model=value;}},getImageEvents:async()=>records};
}
function fakeWorker(t) {
  let message;
  const previous=globalThis.Worker;
  globalThis.Worker=class {postMessage(data){message=data;queueMicrotask(()=>this.onmessage({data:{result:{accepted:false,reason:'Controlled rejection.'}}}));}terminate(){}};
  t.after(()=>{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;});
  return ()=>message;
}

test('semantic and personal training records remain different targets',()=>{
  const personal=imageChoiceHistory(),semantic=personal.map(row=>({...row,id:'semantic-'+row.id,key:'semantic-'+row.key,decisionId:'semantic-'+row.decisionId,task:'semantic'}));
  assert.equal(trainImagePersonalizer(semantic).decisions,0,'public meaning labels cannot become personal taste');
  assert.equal(trainImagePersonalizer(personal,null,{task:'semantic'}).decisions,0,'legacy choices are not semantic ground truth');
  const result=trainImagePersonalizer([...personal,...semantic],null,{task:'semantic',epochs:8,returnCandidate:true});
  assert.equal(result.decisions,60);assert.equal(result.task,'semantic');
  const model=result.model||result.candidate;assert.equal(model.role,'semantic');assert.equal(model.semanticBase,undefined);
  assert.equal(trainImagePersonalizer(personal,model).accepted,false,'personal updates cannot overwrite a semantic head');
});

test('a new personal correction starts exactly at validated semantic scores',()=>{
  const semantic=semanticSeed(),personal=createPreferencePersonalizer(semantic),row=imageChoiceHistory(1)[0];
  assert.equal(isValidatedSemanticModel(semantic),true);assert.equal(personal.role,'preference');
  assert.ok([...personal.weights.slice(-17)].every(w=>w===0));
  assert.equal(personalizerScore(personal,row.features,row.meaningFeatures),personalizerScore(semantic,row.features,row.meaningFeatures));
  assert.notEqual(personalizerScore(semantic,row.features,row.meaningFeatures),personalizerScore(null,row.features,row.meaningFeatures));
  personal.weights[personal.weights.length-1]=100;
  assert.ok(Math.abs(personalizerScore(personal,row.features,row.meaningFeatures)-personalizerScore(semantic,row.features,row.meaningFeatures))<=PERSONAL_PREFERENCE_LIMIT+1e-8);
});

test('personal fitting never changes the semantic head or its reused hidden layers',()=>{
  const semantic=semanticSeed(),before=Float32Array.from(semantic.weights),initialization=createPreferencePersonalizer(semantic);
  const result=trainImagePersonalizer(imageChoiceHistory(),null,{initialization,epochs:24,returnCandidate:true});
  const model=result.model||result.candidate;assert.ok(model);
  assert.deepEqual(semantic.weights,before);assert.deepEqual(model.semanticBase.weights,before);
  assert.deepEqual(model.weights.slice(0,-17),initialization.weights.slice(0,-17));
  assert.ok([...model.weights.slice(-17)].some(w=>w!==0));
  assert.equal(model.role,'preference');assert.equal(model.semanticBase.role,'semantic');
});

test('a zero personal correction cannot pass acceptance by borrowing a semantic improvement',()=>{
  const semantic=semanticSeed(),personal=createPreferencePersonalizer(semantic),split=splitImageDecisions(imageChoiceHistory());
  const result=imageModelAcceptance(personal,null,split.test);
  assert.equal(result.accepted,false);assert.equal(result.before.loss,result.after.loss);
  assert.equal(result.semanticBaseline.loss,result.after.loss);
});

test('rejected generic layers are not silently reused by production personal training',async t=>{
  const capture=fakeWorker(t),semantic=semanticSeed();semantic.genericValidation.accepted=false;
  const trainer=new ImagePersonalizerTraining(persistence(),{pretrained:async()=>({getPretrainedImageModel:()=>semantic,getImagePersonalizerInitialization:()=>assert.fail('Rejected initialization must never be requested')})});
  t.after(()=>trainer.stop());assert.equal(await trainer.current(),null);
  assert.equal(createPreferencePersonalizer(semantic),null);
  await trainer.train();assert.equal(capture().model,null);assert.equal(capture().initialization,null);assert.equal(capture().options.task,'preference');
});

test('production training passes a separate personal initializer while retaining the semantic default',async t=>{
  const capture=fakeWorker(t),semantic=semanticSeed(),store=persistence();
  const trainer=new ImagePersonalizerTraining(store,{pretrained:async()=>({getPretrainedImageModel:()=>semantic})});t.after(()=>trainer.stop());
  assert.equal(await trainer.current(),semantic);await trainer.train({task:'semantic'});
  const message=capture();assert.equal(message.model,null);assert.equal(message.options.task,'preference');
  assert.equal(message.initialization.role,'preference');assert.deepEqual(message.initialization.semanticBase.weights,semantic.weights);
  assert.equal(await store.imageHistory.model(),null);assert.equal(await trainer.current(),semantic);
});


test('curated semantic partitions stay frozen after galleries or whole meanings are removed',()=>{
  const records=imageChoiceHistory().map(row=>({...row,task:'semantic'})), original=splitImageDecisions(records);
  const removed=new Set([original.train[0].id,original.train[1].id,original.train[2].id]);
  const retained=records.filter(record=>!removed.has(record.decisionId));
  const ids=Object.fromEntries(['train','validation','test'].map(name=>[name,original[name].map(d=>d.id).filter(id=>!removed.has(id))]));
  const partition=semanticDatasetPartitions(retained,ids);
  assert.equal(partition.explicit,true);assert.equal(partition.decisions,57);
  for(const name of ['train','validation','test'])assert.deepEqual(partition[name].map(d=>d.id),ids[name]);
  assert.notDeepEqual(splitImageDecisions(retained).train.map(d=>d.id),ids.train,'A changed60/20/20splitwouldmoveheldoutmeaningstotraining');
  const result=trainImagePersonalizer(retained,null,{task:'semantic',datasetPartitions:ids,epochs:1,returnCandidate:true});
  assert.equal(result.decisions,57);assert.equal((result.model||result.candidate).role,'semantic');
});

test('explicit semantic partitions reject missing, unknown and duplicate decisions and mixed meanings',()=>{
  const records=imageChoiceHistory().map(row=>({...row,task:'semantic'})),split=splitImageDecisions(records);
  const ids=Object.fromEntries(['train','validation','test'].map(name=>[name,split[name].map(d=>d.id)]));
  const copy=()=>structuredClone(ids);
  let changed=copy();changed.train.pop();assert.throws(()=>semanticDatasetPartitions(records,changed),/missing active/);
  changed=copy();changed.test.push('unknown');assert.throws(()=>semanticDatasetPartitions(records,changed),/Unknown/);
  changed=copy();changed.test.push(changed.train[0]);assert.throws(()=>semanticDatasetPartitions(records,changed),/Duplicate/);
  changed=copy();changed.train.push(changed.train[0]);assert.throws(()=>semanticDatasetPartitions(records,changed),/Duplicate/);
  const mixed=records.map(r=>r.decisionId===ids.test[0]?{...r,meaningId:records[0].meaningId}:r);
  assert.throws(()=>semanticDatasetPartitions(mixed,ids),/meaning crosses/);
  assert.throws(()=>semanticDatasetPartitions(imageChoiceHistory(),ids),/semantic training records only/);
  assert.throws(()=>trainImagePersonalizer(imageChoiceHistory(),null,{datasetPartitions:ids}),/only for semantic/);
});
