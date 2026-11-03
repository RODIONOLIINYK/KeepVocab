import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SEMANTIC_FILTER, passesImageSemanticGate } from '../js/services/imageSemanticGate.js';
import { CLIP_DIMENSION } from '../js/ml/clipConfig.js';
import { PERSONALIZER_INPUTS, createPersonalizer, encodeMeaning } from '../js/services/imagePersonalizer.js';
import { rankEmbeddedImages } from '../js/services/imageLearning.js';
import { getImageProviderSettings, findRelevantImages } from '../js/services/imageSearch.js';
import { MemoryStorage } from '../js/services/driveSync.js';

const vector = axis => Array.from({length:CLIP_DIMENSION},(_,i)=>Number(i===axis));
test('the user-selected semantic cutoff is inclusive, selected must exceed unwanted, and missing scores fail',()=>{
  assert.deepEqual(IMAGE_SEMANTIC_FILTER,{minimumSimilarity:.19,candidatePoolSize:45});
  assert.equal(passesImageSemanticGate({selected:.19,unwanted:.189}),true);
  assert.equal(passesImageSemanticGate({selected:.25,unwanted:.24,margin:.02}),true);
  for(const row of [{selected:.1899,unwanted:0},{selected:.19,unwanted:.19},{selected:.22,unwanted:.25},{selected:.24,unwanted:.1,margin:-.01},{selected:NaN,unwanted:0},{selected:.9},null])assert.equal(passesImageSemanticGate(row),false);
});
test('personal taste cannot resurrect a failed semantic match or unwanted-content rejection',()=>{
  const model=createPersonalizer();model.weights.fill(0);
  model.weights[0]=10;model.weights[PERSONALIZER_INPUTS * 32]=1;model.weights[PERSONALIZER_INPUTS * 32 + 32 + 32 * 16]=10;
  const items=[.18,.21,.24].map((selected,i)=>({candidate:{id:i},vector:vector(i),meaningFeatures:encodeMeaning(vector(3)),
    semantic:{selected,margin:0,unwanted:i===2?.25:0,contrast:null,score:selected}}));
  assert.equal(rankEmbeddedImages(items,model)[0].candidate.id,0,'the rejected photo has the largest learned score');
  assert.deepEqual(rankEmbeddedImages(items,model,{semanticFilter:true}).map(r=>r.candidate.id),[1]);
  assert.deepEqual(rankEmbeddedImages([items[0],items[2]],model,{semanticFilter:true}),[],'no metadata backfill when every image fails');
});
test('a fresh app defaults to public catalogs, while an explicitly saved Pexels choice is retained',()=>{
  const storage=new MemoryStorage();assert.equal(getImageProviderSettings(storage).provider,'openverse');
  storage.setItem('keepvocab_image_provider_v1',JSON.stringify({provider:'pexels',pexelsApiKey:'synthetic-test-key'}));
  assert.equal(getImageProviderSettings(storage).provider,'pexels');
});
test('a full configured Pexels pool avoids unrelated catalog requests',async()=>{
  const calls=[];const results=await findRelevantImages({word:'fox',partOfSpeech:'noun',definition:'A fox running on grass.'},{
    provider:'pexels',pexelsApiKey:'synthetic-test-key',storage:new MemoryStorage(),aiScenes:false,
    onlyExtraQueries:true,extraQueries:['semantic gate pool fox running'],validateImages:false,limit:6,
    fetchImpl:async url=>{calls.push(new URL(url).hostname);return {ok:true,json:async()=>({photos:Array.from({length:40},(_,i)=>({id:99000+i,url:`https://www.pexels.com/photo/${99000+i}/`,alt:`Fox running semantic-gate-pool ${i}`,src:{medium:`https://images.pexels.com/photos/${99000+i}/image.jpeg`}}))})};}
  });
  assert.equal(results.length,6);assert.deepEqual(calls,['api.pexels.com']);
});

test('if every scored image fails, manual review contains the nine highest final scores without diversity reranking',()=>{
 const items=Array.from({length:12},(_,i)=>({candidate:{id:i},vector:vector(i),semantic:{selected:.1,unwanted:.2,margin:0,contrast:null,score:100-i,cosine:(11-i)/20}}));
 const reversed=[...items].reverse();
 const ranked=rankEmbeddedImages(reversed,null,{semanticFilter:true,fallbackLimit:9});
 assert.equal(ranked.length,9);
 assert.deepEqual(ranked.map(r=>r.candidate.id),[0,1,2,3,4,5,6,7,8]);
 assert.ok(ranked.every(r=>r.belowThreshold&&r.score===r.semantic.score));
 const passing={candidate:{id:'passes'},vector:vector(20),semantic:{selected:.3,unwanted:.1,margin:.1,contrast:.2,score:.3,cosine:.3}};
 assert.deepEqual(rankEmbeddedImages([...items,passing],null,{semanticFilter:true,fallbackLimit:9}).map(r=>r.candidate.id),['passes']);
});
