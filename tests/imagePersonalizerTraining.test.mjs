import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { ImagePersonalizerTraining } from '../js/services/imagePersonalizerTraining.js';
import { ImageLearningHistoryStore } from '../js/services/imageLearningHistory.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { createPersonalizer } from '../js/services/imagePersonalizer.js';
import { imageChoiceHistory } from './fixtures/imageChoices.mjs';
const persistence=async()=>{const imageHistory=new ImageLearningHistoryStore(new MemoryStorage(),undefined);await imageHistory.merge(imageChoiceHistory());return {imageHistory,getImageEvents:()=>imageHistory.all()};};
const noPretrained=async()=>({getPretrainedImageModel:()=>null});
function replaceWorker(t,Worker){const previous=globalThis.Worker;globalThis.Worker=Worker;t.after(()=>{if(previous===undefined)delete globalThis.Worker;else globalThis.Worker=previous;});}
test('a real background worker trains and promotes only its held-out-accepted candidate',async t=>{
  class BrowserWorker {
    constructor(url){this.worker=new NodeWorker(`const { parentPort } = require('node:worker_threads'); globalThis.self={postMessage: data=>parentPort.postMessage(data)}; import(${JSON.stringify(url.href)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
      this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}
    postMessage(data){this.worker.postMessage(data);} terminate(){return this.worker.terminate();}
  }
  replaceWorker(t,BrowserWorker);const p=await persistence(),trainer=new ImagePersonalizerTraining(p,{pretrained:noPretrained});t.after(()=>trainer.stop());
  const operation=trainer.train({epochs:24});assert.equal((await p.imageHistory.model())??null,null);
  const result=await operation;assert.equal(result.accepted,true,result.reason);assert.equal((await trainer.current()).revision,1);
});
test('new feedback arriving during worker training prevents a stale candidate from replacing the current model',async t=>{
  let worker;class DeferredWorker{constructor(){worker=this;}postMessage(){}terminate(){}}
  replaceWorker(t,DeferredWorker);const p=await persistence(),trainer=new ImagePersonalizerTraining(p,{pretrained:noPretrained});t.after(()=>trainer.stop());
  const operation=trainer.train();while(!worker)await new Promise(resolve=>setImmediate(resolve));
  const row=imageChoiceHistory(1)[0];await p.imageHistory.append({...row,id:'new-choice',key:'new-pair',decisionId:'new-choice',updatedAt:'2027-01-01T00:00:00Z'});
  worker.onmessage({data:{result:{accepted:true,model:createPersonalizer()}}});
  const result=await operation;assert.equal(result.accepted,false);assert.match(result.reason,/changed during training/);assert.equal((await p.imageHistory.model())??null,null);
});
test('reset or turning suggestions off cancels background training',async t=>{
  let worker;class DeferredWorker{constructor(){worker=this;}postMessage(){}terminate(){this.terminated=true;}}
  replaceWorker(t,DeferredWorker);const p=await persistence(),trainer=new ImagePersonalizerTraining(p,{pretrained:noPretrained});
  const operation=trainer.train();while(!worker)await new Promise(resolve=>setImmediate(resolve));trainer.stop();
  assert.equal((await operation).accepted,false);assert.equal(worker.terminated,true);assert.equal((await p.imageHistory.model())??null,null);
});
