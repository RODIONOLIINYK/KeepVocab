import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_TAG } from '../js/ml/clipConfig.js';
import { encodeFeatures, preferenceFeatures } from '../js/services/imagePreferences.js';
import { IMAGE_PREPROCESSING, createPersonalizer, personalizerInput, personalizerScore, encodeMeaning, trainImagePersonalizer, splitImageDecisions, imageModelAcceptance, activeImageExamples, validPersonalizer } from '../js/services/imagePersonalizer.js';

import { rankEmbeddedImages } from '../js/services/imageLearning.js';
import { imageChoiceHistory } from './fixtures/imageChoices.mjs';
const vector = axis => Array.from({ length: 512 }, (_, i) => Number(i === axis));
const features = axis => encodeFeatures(preferenceFeatures(vector(axis), { selected: .4, margin: .1, unwanted: .05 }));
test('32/16 fusion head has the declared size, initially matches CLIP, and receives both embeddings and interactions', () => {
  const model = createPersonalizer(); assert.equal(model.weights.length, 49825); assert.equal(validPersonalizer(model), true);
  const input = personalizerInput(features(0), encodeMeaning(vector(1)));
  assert.equal(input.length, 1539); assert.equal(input[0], 1); assert.equal(input[513], 1); assert.equal(input[1024], 0);
  assert.ok(Math.abs(personalizerScore(model, features(0), encodeMeaning(vector(1))) - personalizerScore(null, features(0), encodeMeaning(vector(1)))) < 2e-8);
});
test('all pairs and decisions for one meaning stay in one chronological partition', () => {
  const history = imageChoiceHistory(); history.push({ ...history[0], id: 'another-pair', key: 'another-key', decisionId: 'second-choice', updatedAt: history[40].updatedAt });
  const split = splitImageDecisions(history);
  const sets = ['train', 'validation', 'test'].map(key => new Set(split[key].map(d => d.meaningId)));
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) assert.equal([...sets[i]].some(id => sets[j].has(id)), false);
  assert.equal([...split.train, ...split.validation, ...split.test].flatMap(d => d.records).length, 61);
});
test('real backprop learns opposite image preferences for run versus stand meanings and passes unseen-meaning evaluation', () => {
  const result = trainImagePersonalizer(imageChoiceHistory(), null);
  assert.equal(result.accepted, true, JSON.stringify({ reason: result.reason, before: result.before?.loss, after: result.after?.loss }));
  assert.ok(result.after.loss < result.baseline.loss && result.lowerBound > 0);
  const model = result.model;
  assert.ok(personalizerScore(model, features(0), encodeMeaning(vector(0))) > personalizerScore(model, features(1), encodeMeaning(vector(0))));
  assert.ok(personalizerScore(model, features(1), encodeMeaning(vector(1))) > personalizerScore(model, features(0), encodeMeaning(vector(1))));
  assert.equal(model.trainingDecisionIds.some(id => model.testDecisionIds.includes(id)), false);
  assert.ok(model.weights.some(w => w !== 0));
  const items=[1,0].map(axis=>({candidate:{id:axis},vector:vector(axis),meaningFeatures:encodeMeaning(vector(0)),semantic:{selected:.4,margin:.1,unwanted:.05,score:.4475}}));
  assert.equal(rankEmbeddedImages(items,null)[0].candidate.id,1);
  assert.equal(rankEmbeddedImages(items,model)[0].candidate.id,0,'The live ranking path must actually apply the accepted head');
});
test('too little, stale, malformed or unsupported data cannot authorize a new model', () => {
  assert.equal(trainImagePersonalizer(imageChoiceHistory(12)).accepted, false);
  const row = imageChoiceHistory(1)[0];
  assert.equal(activeImageExamples([{ ...row, preprocessing: 'legacy' }]).length, 0);
  assert.equal(activeImageExamples([{ ...row, meaningFeatures: 'invalid' }]).length, 0);
  const corrected = { ...row, id: 'correction', features: row.preferredFeatures, preferredFeatures: row.features, updatedAt: '2027-01-01T00:00:00Z' };
  assert.deepEqual(activeImageExamples([row, corrected]).map(r => r.id), ['correction']);
  const base = createPersonalizer(), split = splitImageDecisions(imageChoiceHistory());
  assert.equal(imageModelAcceptance(base, null, split.test).accepted, false);
  base.trainingDecisionIds = split.test.map(d => d.id);
  assert.equal(trainImagePersonalizer(imageChoiceHistory(), base).accepted, false);
});

test('personal learning from a pretrained initialization freezes its hidden layers', () => {
  const initialization={...createPersonalizer(),pretrained:true};
  const result=trainImagePersonalizer(imageChoiceHistory(),null,{epochs:200,initialization,outputOnly:true,returnCandidate:true});
  const model=result.model||result.candidate;assert.ok(model);
  assert.deepEqual(model.weights.slice(0,-17),initialization.weights.slice(0,-17));
  assert.ok(model.weights.slice(-17).some(w=>w!==0));
});

test('a model cannot keep reusing answers that already chose its earlier weights', () => {
  const split=splitImageDecisions(imageChoiceHistory()), incumbent=createPersonalizer();
  for(const key of ['validationDecisionIds','testDecisionIds']){
    incumbent[key]=[split.test[0].id];
    const result=trainImagePersonalizer(imageChoiceHistory(),incumbent);
    assert.equal(result.accepted,false);assert.match(result.reason,/unseen/);delete incumbent[key];
  }
});

test('a learned fusion branch can overturn a CLIP score gap larger than the retired residual cap', () => {
  const model=createPersonalizer();model.weights.fill(0);
  model.weights[1536]=1;model.weights[49280]=1;model.weights[49808]=-3;
  const items=[.7,.4].map((selected,index)=>({candidate:{id:index},vector:vector(index),meaningFeatures:encodeMeaning(vector(2)),
    semantic:{selected,margin:0,unwanted:0,contrast:null,score:selected}}));
  assert.equal(rankEmbeddedImages(items,null)[0].candidate.id,0);
  assert.equal(rankEmbeddedImages(items,model)[0].candidate.id,1);
});
