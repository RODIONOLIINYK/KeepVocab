import test from 'node:test';import assert from 'node:assert/strict';import vm from'node:vm';import {readFileSync}from'node:fs';
import {IMAGE_PREPROCESSING}from'../js/services/imagePersonalizer.js';
import * as config from'../js/ml/clipConfig.js';import{normalizedVector}from'../js/services/imagePreferences.js';
function fixture(){
 const source=readFileSync(new URL('../scripts/clip-worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');const calls={texts:[],images:[]};
 const tensor=axes=>({data:Float32Array.from(axes.flatMap(axis=>Array.from({length:768},(_,i)=>Number(i===axis)))),type:'float32',dispose(){}});
 const model={tokenizer:(texts)=>{calls.texts.push(texts);return{input_ids:{texts,dispose(){}}};},textModel:async({input_ids})=>({pooler_output:tensor(input_ids.texts.map(s=>s.length%20))}),processor:async frames=>({pixel_values:{frames,dispose(){}}}),visionModel:async({pixel_values})=>{calls.images.push(pixel_values.frames);return{pooler_output:tensor(pixel_values.frames.map(f=>f.axis))};}};
 const context=vm.createContext({...config,IMAGE_PREPROCESSING,normalizedVector,env:{fetch:()=>{},backends:{onnx:{wasm:{}}}},self:{postMessage(){}},Blob,crypto,URL,Map,Set,Promise,Float32Array,RawImage:{fromBlob:async()=>({width:64,height:64})},fullFrameImage:async()=>({axis:1}),centerCropImage:async()=>({axis:2})});
 vm.runInContext(source,context);context.fixtureModel=model;vm.runInContext('models=Promise.resolve(fixtureModel)',context);return{context,calls};
}
test('text inference batches only cache misses and preserves row order',async()=>{
 const{context,calls}=fixture();context.payload={texts:['first','second','first']};const a=await vm.runInContext("run({type:'texts',payload})",context);assert.equal(calls.texts.length,1);assert.equal(calls.texts[0].length,2);assert.deepEqual(Array.from(a[0]),Array.from(a[2]));
 context.payload={texts:['second','new','first']};const b=await vm.runInContext("run({type:'texts',payload})",context);assert.equal(calls.texts.length,2);assert.deepEqual(Array.from(calls.texts[1]),['new']);assert.deepEqual(Array.from(b[0]),Array.from(a[1]));assert.deepEqual(Array.from(b[2]),Array.from(a[0]));
});
test('full and crop share one inference; partial cache computes only the missing view',async()=>{
 const{context,calls}=fixture();context.payload={blob:new Blob(['first'],{type:'image/jpeg'}),multiView:false};await vm.runInContext("run({type:'image',payload})",context);
 context.payload.multiView=true;const partial=await vm.runInContext("run({type:'image',payload})",context);assert.deepEqual(calls.images.map(x=>x.length),[1,1]);
 context.payload={blob:new Blob(['second'],{type:'image/jpeg'}),multiView:true};const batch=await vm.runInContext("run({type:'image',payload})",context);assert.deepEqual(calls.images.map(x=>x.length),[1,1,2]);assert.deepEqual(Array.from(batch.vector),Array.from(partial.vector));await vm.runInContext("run({type:'image',payload})",context);assert.equal(calls.images.length,3);
});
