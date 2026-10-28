import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readJsonFile} from '../scripts/lib/json-files.mjs';
import {validateSemanticSupervision,validatePretrainingBenchmark,comparePretrainingModels} from '../scripts/lib/image-pretraining-benchmark.mjs';
import {CLIP_TAG,LEGACY_CLIP_TAG} from '../js/ml/clipConfig.js';
const root=new URL('./fixtures/image-pretraining-v2/',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
test('the real semantic dataset retains thousands of reviewed comparisons, hundreds of meanings and disjoint frozen source partitions',async()=>{
 const manifest=await readJsonFile(new URL('cases.json',root)),encoded=await readJsonFile(new URL('embeddings.json.gz',root));
 validateSemanticSupervision(encoded,manifest);const validated=validatePretrainingBenchmark(encoded,manifest);
 assert.equal(encoded.events.length,2390);assert.equal(manifest.cases.length,638);assert.equal(new Set(manifest.cases.map(c=>c.meaningId)).size,237);
 assert.equal(new Set(manifest.cases.map(c=>c.feedback.selected[0])).size,638,'Every reference is a distinct photo');
 assert.equal(new Set(manifest.cases.map(c=>c.domain)).size,19);assert.equal(manifest.reviewAudit.modelScoresVisibleToReviewers,false);
 assert.equal(manifest.reviewAudit.reviewedGalleries,973);assert.equal(manifest.finalSourceAudit.crossSplitNearDuplicatePairs.length,0);
 for(const c of manifest.cases){assert.equal(c.annotation.reviewStatus,'visually-reviewed');assert.equal(c.feedback.wrong.length,c.candidates.length-1);}
 assert.equal(validated.diversity.train.meanings,141);assert.equal(validated.diversity.validation.meanings,49);assert.equal(validated.diversity.test.meanings,47);
 assert.equal(encoded.encoder,CLIP_TAG);assert.notEqual(encoded.encoder,LEGACY_CLIP_TAG);
});
test('the frozen candidate and report reproduce the exact CLIP versus MLP test comparison',async()=>{
 const manifest=await readJsonFile(new URL('cases.json',root)),encoded=await readJsonFile(new URL('embeddings.json.gz',root)),saved=await readJsonFile(new URL('candidate.json.gz',root));
 const report=await readJsonFile(new URL('../docs/image-pretraining-v2-report.json',import.meta.url));
 assert.equal(report.dataSha256,sha(JSON.stringify(encoded.events)));assert.equal(report.encoder,CLIP_TAG);
 const bytes=Buffer.alloc(saved.model.weights.length*4);saved.model.weights.forEach((value,i)=>bytes.writeFloatLE(value,i*4));assert.equal(sha(bytes),report.candidateWeightsSha256);
 const results=comparePretrainingModels(validatePretrainingBenchmark(encoded,manifest),saved.model,{bootstrapSamples:10});
 for(const name of ['train','validation','test'])for(const model of ['rawClip','baseline','mlp']){
  assert.equal(results[name][model].chosenAt1,report.splits[name][model].chosenAt1);
  assert.ok(Math.abs(results[name][model].meanPairwiseLoss-report.splits[name][model].meanPairwiseLoss)<1e-12);
 }
 assert.equal(report.accepted,false);assert.equal(results.test.rawClip.chosenAt1,101);assert.equal(results.test.baseline.chosenAt1,107);assert.equal(results.test.mlp.chosenAt1,105);
});
