import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SEMANTIC_FILTER, passesImageSemanticGate } from '../js/services/imageSemanticGate.js';
import { CLIP_DIMENSION } from '../js/ml/clipConfig.js';
import { PERSONALIZER_INPUTS, createPersonalizer, encodeMeaning } from '../js/services/imagePersonalizer.js';
import { rankEmbeddedImages } from '../js/services/imageLearning.js';
import { getImageProviderSettings, findRelevantImages } from '../js/services/imageSearch.js';
import { MemoryStorage } from '../js/services/driveSync.js';

const vector = axis => Array.from({length:CLIP_DIMENSION},(_,i)=>Number(i===axis));
test('the encoder-specific semantic cutoff is inclusive, selected must exceed unwanted, and missing scores fail',()=>{
  assert.deepEqual(IMAGE_SEMANTIC_FILTER,{minimumSimilarity:.13,closeContrastMargin:.02,candidatePoolSize:45});
  assert.equal(passesImageSemanticGate({selected:.13,unwanted:.129}),true);
  assert.equal(passesImageSemanticGate({selected:.25,unwanted:.24,margin:.02}),true);
  for(const row of [{selected:.1299,unwanted:0},{selected:.13,unwanted:.13},{selected:.22,unwanted:.25},{selected:.24,unwanted:.1,margin:-.01},{selected:NaN,unwanted:0},{selected:.9},null])assert.equal(passesImageSemanticGate(row),false);
});
test('personal taste cannot resurrect a failed semantic match or unwanted-content rejection',()=>{
  const model=createPersonalizer();model.weights.fill(0);
  model.weights[0]=10;model.weights[PERSONALIZER_INPUTS * 32]=1;model.weights[PERSONALIZER_INPUTS * 32 + 32 + 32 * 16]=10;
  const items=[.12,.21,.24].map((selected,i)=>({candidate:{id:i},vector:vector(i),meaningFeatures:encodeMeaning(vector(3)),
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

test('neutral or untrained taste preferences cannot label a strong semantic match uncertain',()=>{
 const semantic={selected:.4,unwanted:.06,margin:0,contrast:null,score:.385,cosine:.4};
 const item={candidate:{id:'clear'},vector:vector(0),semantic};
 const [ranked]=rankEmbeddedImages([item],null,{semanticFilter:true});
 assert.equal(ranked.probability,.5,'No personal feedback means neutral taste, not low semantic confidence');
 assert.equal(ranked.uncertain,false);
 const [ambiguous]=rankEmbeddedImages([{...item,semantic:{...semantic,contrast:.39,margin:.01}}],null,{semanticFilter:true});
 assert.equal(ambiguous.uncertain,true,'A close competing meaning still warrants uncertainty');
});

test('the inspected foreground apple passes the SigLIP2 shortlist without turning neutral taste into uncertainty',()=>{
 // Exact compact-model outputs for Red_Apple.jpg, source SHA256:
 // 60baaee8cff7502bc7cde3cefaf940247a8a9ee5bff7522efc515710b54f36ce.
 const semantic={selected:.1558776236227925,unwanted:.07008713958042258,margin:0,contrast:null,
  cropProminence:-.00008629798915851805,score:.13835583872768686,cosine:.1558905683211663};
 assert.equal(passesImageSemanticGate(semantic),true);
 const [ranked]=rankEmbeddedImages([{candidate:{id:'verified-red-apple'},vector:vector(0),semantic}],null,{semanticFilter:true,fallbackLimit:9});
 assert.equal(ranked.uncertain,false);assert.ok(!ranked.belowThreshold);
 assert.equal(passesImageSemanticGate({selected:.10761977960923627,unwanted:.05871344923801159,margin:0,contrast:null}),false);
});

test('overlapping dictionary alternatives cannot veto a literal apple, while explicit visual contrasts remain strict',()=>{
 const semantic={selected:.15467521060546122,unwanted:.0704723497034622,contrast:.1613399211306754,margin:-.006664710525214168,score:.133,cosine:.15577300200786295,contrastSource:'dictionary'};
 const [ranked]=rankEmbeddedImages([{candidate:{id:'apple-with-metaphorical-alternative'},vector:vector(0),semantic}],null,{semanticFilter:true,fallbackLimit:9});
 assert.equal(ranked.belowThreshold,undefined);
 assert.equal(ranked.uncertain,false);
 assert.equal(passesImageSemanticGate({...semantic,contrastSource:'explicit'}),false);
 assert.equal(passesImageSemanticGate({...semantic,selected:.08,unwanted:.02}),false);
});
