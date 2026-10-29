import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateImagePipeline } from '../js/services/imageEvaluation.js';
import { imageClipPrompts } from '../js/services/imageLearning.js?v=18900';
import { getPretrainedImageModel,getImagePersonalizerInitialization,PRETRAINED_IMAGE_REPORT } from '../js/ml/pretrainedImagePersonalizer.js';
import { splitImageDecisions,personalizerScore } from '../js/services/imagePersonalizer.js';
const vector=axis=>Array.from({length:512},(_,i)=>Number(i===axis));
test('the evaluation path calls image/text encoders and ignores metadata promises about what pixels depict',async()=>{
  const seen=[];const fixtures={kind:'synthetic-regression',cases:[{id:'fox',word:{word:'run',definition:'Move quickly on foot.',imageScenes:{scenes:['a fox running across a meadow']}},candidates:[{id:'standing',url:'https://test/standing',title:'running fox'},{id:'running',url:'https://test/running',title:'standing fox'}],feedback:{selected:['running'],wrong:['standing']}}]};
  const report=await evaluateImagePipeline(fixtures,{evidence:'injected-vectors',embedTexts:async texts=>texts.map((_,i)=>vector(i<2?0:2)),embedImage:async image=>{seen.push(image.id);return vector(image.id==='running'?0:1);}});
  assert.deepEqual(seen,['standing','running']);assert.equal(report.models.clip.chosenAt1,1);assert.equal(report.models.clip.explicitlyWrongAt1,0);
  assert.equal(report.events.length,1);assert.ok(report.events[0].meaningFeatures);assert.equal(report.evidence,'injected-vectors');
});
test('saved scenes and the actual active query reach CLIP even when an explicit-search path passes empty scenes',()=>{
  const prompt=imageClipPrompts({word:'run',definition:'Move quickly.',imageScenes:{scenes:['a fox running across a meadow'],contrasts:['a fox standing beside a tree']}},{scenes:[],extraQueries:['a runner sprinting along a track']});
  assert.ok(prompt.texts.includes('A photo of a fox running across a meadow'));assert.ok(prompt.texts.includes('A photo of a runner sprinting along a track'));
  assert.ok(prompt.texts.includes('A photo of a fox standing beside a tree'));assert.equal(prompt.alternativeCount,1);
});
test('the real-photo pretraining fixture keeps files, hashes and meanings out of different splits',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/image-pretraining/cases.json',import.meta.url),'utf8'));
  const sets=Object.fromEntries(['train','validation','test'].map(name=>[name,new Set(fixture.cases.filter(c=>c.split===name).flatMap(c=>c.candidates.map(p=>p.sha256)))]));
  for(const [a,b]of[['train','validation'],['train','test'],['validation','test']])assert.equal([...sets[a]].some(h=>sets[b].has(h)),false);
  const encoded=JSON.parse(await readFile(new URL('./fixtures/image-pretraining/embeddings.json',import.meta.url),'utf8'));
  const split=splitImageDecisions(encoded.events);assert.equal(split.decisions,0,'Historical q8-vision features are archived but excluded from the corrected encoder training.');
});
test('a bundled semantic head must pass its benchmark and rejected layers never initialize personal learning',async()=>{
  assert.equal(PRETRAINED_IMAGE_REPORT.targetTask,'semantic');
  const semantic=getPretrainedImageModel(),seed=getImagePersonalizerInitialization();
  if(!PRETRAINED_IMAGE_REPORT.accepted){assert.equal(semantic,null);assert.equal(seed,null);return;}
  assert.equal(semantic.role,'semantic');assert.equal(seed.role,'preference');assert.equal(seed.semanticBase.genericValidation.accepted,true);
  assert.deepEqual(seed.semanticBase.weights,semantic.weights);assert.deepEqual(seed.weights,semantic.weights);
  const encoded=JSON.parse(await readFile(new URL('./fixtures/image-pretraining/embeddings.json',import.meta.url),'utf8')),row=encoded.events[0];
  assert.equal(personalizerScore(seed,row.features,row.meaningFeatures),personalizerScore(semantic,row.features,row.meaningFeatures));
});
