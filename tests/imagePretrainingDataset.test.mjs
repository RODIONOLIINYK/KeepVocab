import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readJsonFile} from '../scripts/lib/json-files.mjs';
import {validateSemanticSupervision,validatePretrainingBenchmark} from '../scripts/lib/image-pretraining-benchmark.mjs';
import {activeImageExamples,validPersonalizer} from '../js/services/imagePersonalizer.js';
import {CLIP_TAG,PREVIOUS_CLIP_TAG} from '../js/ml/clipConfig.js';
const root=new URL('./fixtures/image-pretraining-v2/',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');

test('the archived semantic dataset retains reviewed comparisons and disjoint frozen source/meaning partitions',async()=>{
 const manifest=await readJsonFile(new URL('cases.json',root)),encoded=await readJsonFile(new URL('embeddings.json.gz',root));
 validateSemanticSupervision(encoded,manifest);
 assert.equal(encoded.events.length,2390);assert.equal(manifest.cases.length,638);assert.equal(new Set(manifest.cases.map(c=>c.meaningId)).size,237);
 assert.equal(new Set(manifest.cases.map(c=>c.feedback.selected[0])).size,638);
 assert.equal(new Set(manifest.cases.map(c=>c.domain)).size,19);assert.equal(manifest.reviewAudit.modelScoresVisibleToReviewers,false);
 assert.equal(manifest.reviewAudit.reviewedGalleries,973);assert.equal(manifest.finalSourceAudit.crossSplitNearDuplicatePairs.length,0);
 const owners=new Map();
 const own=(key,split)=>{assert.ok(!owners.has(key)||owners.get(key)===split,`Cross-split identity: ${key}`);owners.set(key,split);};
 for(const c of manifest.cases){
  assert.equal(c.annotation.reviewStatus,'visually-reviewed');assert.equal(c.feedback.wrong.length,c.candidates.length-1);
  own('meaning:'+c.meaningId,c.split);own('family:'+(c.familyId||c.meaningId),c.split);
  for(const p of c.candidates){own('photo:'+p.id,c.split);own('hash:'+p.sha256,c.split);const u=new URL(p.url);u.search='';u.hash='';own('url:'+u.href,c.split);}
 }
 for(const [split,count]of [['train',141],['validation',49],['test',47]])assert.equal(new Set(manifest.cases.filter(c=>c.split===split).map(c=>c.meaningId)).size,count);
 assert.equal(encoded.encoder,PREVIOUS_CLIP_TAG);assert.notEqual(encoded.encoder,CLIP_TAG);
 assert.throws(()=>validatePretrainingBenchmark(encoded,manifest),/unsupported encoder/);
 assert.deepEqual(activeImageExamples(encoded.events),[],'Archived Q8 text vectors are not FP16 training data');
});

test('historical Q8-text candidate/report remain intact and rejected by the current encoder',async()=>{
 const encoded=await readJsonFile(new URL('embeddings.json.gz',root)),saved=await readJsonFile(new URL('candidate.json.gz',root));
 const report=await readJsonFile(new URL('../docs/image-pretraining-v2-report.json',import.meta.url));
 assert.equal(report.dataSha256,sha(JSON.stringify(encoded.events)));assert.equal(report.encoder,PREVIOUS_CLIP_TAG);
 const bytes=Buffer.alloc(saved.model.weights.length*4);saved.model.weights.forEach((value,i)=>bytes.writeFloatLE(value,i*4));assert.equal(sha(bytes),report.candidateWeightsSha256);
 assert.equal(saved.model.encoder,PREVIOUS_CLIP_TAG);assert.equal(validPersonalizer(saved.model),false);
 assert.equal(report.accepted,false);assert.equal(report.splits.test.rawClip.chosenAt1,101);assert.equal(report.splits.test.baseline.chosenAt1,107);assert.equal(report.splits.test.mlp.chosenAt1,105);
});
