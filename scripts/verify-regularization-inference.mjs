// Independent JS inference, including native BatchNorm and folded app weights.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark } from './lib/image-pretraining-benchmark.mjs';
import { auditMeaningShiftSplit } from './lib/image-meaning-shift.mjs';
import { personalizerInput, createPersonalizerScorer } from '../js/services/imagePersonalizer.js';
import { decodeFeatures, sigmoid } from '../js/services/imagePreferences.js';
const directory=process.argv[2]||'work/image-regularization',report=await readJsonFile(`${directory}/report.json.gz`);
const plan=await readJsonFile(report.protocol.dataSplit);
for(const file of plan.preservation)if(createHash('sha256').update(await readFile(file.path)).digest('hex')!==file.sha256)throw Error('Original data changed');
const original=validatePretrainingBenchmark(await readJsonFile(plan.sourceFeatures),await readJsonFile(plan.sourceManifest));
const audits=Object.fromEntries(['seen','unseen'].map(arm=>[arm,auditMeaningShiftSplit(original,plan,arm)]));
const stateHash=state=>{
  const hash=createHash('sha256');
  for(const [map,width]of[[state.parameters,4],[state.running,8]])for(const key of Object.keys(map).sort()){
    hash.update(key);const numbers=map[key].flat(Infinity),bytes=Buffer.alloc(numbers.length*width);
    numbers.forEach((value,i)=>width===4?bytes.writeFloatLE(value,i*width):bytes.writeDoubleLE(value,i*width));hash.update(bytes);
  }
  return hash.digest('hex');
};
function scorer(state){
  const cache=new Map();
  return(features,meaning)=>{
    const key=features+'|'+meaning;if(cache.has(key))return cache.get(key);
    const x=decodeFeatures(features);let a=personalizerInput(features,meaning);
    if(state.inputNormalization){const {mean,scale}=state.inputNormalization;a=Float32Array.from(a,(v,i)=>(v-mean[i])/scale[i]);}
    if(state.inputIndices)a=Float32Array.from(state.inputIndices,i=>a[i]);
    for(let layer=0;layer<3;layer++){
      const w=state.parameters[`w${layer}`],b=state.parameters[`b${layer}`],next=new Float32Array(b.length);
      for(let j=0;j<b.length;j++){
        let z=b[j];for(let i=0;i<a.length;i++)z+=a[i]*w[j][i];z=Math.fround(z);
        if(state.batchNorm&&layer<2)z=Math.fround((z-state.running[`m${layer}`][j])*(1/Math.sqrt(state.running[`v${layer}`][j]+state.epsilon))*state.parameters[`g${layer}`][j]+state.parameters[`t${layer}`][j]);
        next[j]=layer<2?Math.max(0,z):z;
      }
      a=next;
    }
    const result=.5*(x[512]+.6*x[513]-.25*Math.max(0,x[514]))+.5*a[0];if(!Number.isFinite(result))throw Error('Nonfinite native inference');cache.set(key,result);return result;
  };
}
const checks=[];let maximumFoldScoreError=0,maximumMetricError=0;
for(const run of report.runs){
  const name=run.config.name,saved=await readJsonFile(`${directory}/runs/${name}/run.json.gz`),audit=audits[run.config.arm];
  for(const checkpoint of ['selected','last']){
    const item=saved[checkpoint];if(item.stateSha256&&stateHash(item.state)!==item.stateSha256)throw Error('Native state checksum changed');
    if(item.sha256){const bytes=Buffer.alloc(item.foldedModel.weights.length*4);item.foldedModel.weights.forEach((v,i)=>bytes.writeFloatLE(v,i*4));if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Folded state checksum changed');}
    const native=scorer(item.state),folded=createPersonalizerScorer(item.foldedModel);
    for(const split of ['train','validation','test']){
      let correct=0,foldCorrect=0,loss=0,galleryLoss=0,brier=0,pairwise=0;
      const rows=run.metrics[split][checkpoint].rows;
      for(const [index,decision]of audit.split[split].entries()){
        const c=audit.cases.get(decision.id),scores=c.candidates.map(photo=>native(c.features.get(photo.id),c.meaningFeatures));
        const fs=c.candidates.map(photo=>folded(c.features.get(photo.id),c.meaningFeatures));
        maximumFoldScoreError=Math.max(maximumFoldScoreError,...scores.map((s,i)=>Math.abs(s-fs[i])));
        const ref=c.candidates.findIndex(photo=>photo.id===c.reference),top=scores.indexOf(Math.max(...scores)),ftop=fs.indexOf(Math.max(...fs));
        correct+=Number(top===ref);foldCorrect+=Number(ftop===ref);
        if(Number(top===ref)!==rows[index].chosenAt1)throw Error(`Native ranking mismatch ${name}/${checkpoint}/${split}/${c.id}`);
        const others=scores.filter((_s,i)=>i!==ref),p=others.map(s=>sigmoid(8*(scores[ref]-s)));
        loss+=p.reduce((n,p)=>n-Math.log(Math.max(1e-8,p)),0)/p.length;
        brier+=p.reduce((n,p)=>n+(1-p)**2,0)/p.length;
        pairwise+=others.filter(s=>scores[ref]>s).length/others.length;
        const logits=scores.map(s=>8*s),max=Math.max(...logits);galleryLoss+=max+Math.log(logits.reduce((n,z)=>n+Math.exp(z-max),0))-logits[ref];
      }
      const expected=run.metrics[split][checkpoint],n=audit.split[split].length;
      const actual={chosenAt1:correct,loss:loss/n,galleryCrossEntropy:galleryLoss/n,brier:brier/n,pairwiseAccuracy:pairwise/n};
      if(correct!==expected.chosenAt1||foldCorrect!==correct)throw Error('Folded ranking changed');
      for(const key of ['loss','galleryCrossEntropy','brier','pairwiseAccuracy'])maximumMetricError=Math.max(maximumMetricError,Math.abs(actual[key]-expected[key]));
      checks.push({name,checkpoint,split,...actual});
    }
  }
}
if(maximumFoldScoreError>5e-5||maximumMetricError>2e-6)throw Error(`Inference tolerance exceeded: fold=${maximumFoldScoreError},metrics=${maximumMetricError}`);
const result={passed:true,checks,splitCheckpointChecks:checks.length,maximumFoldScoreError,foldScoreTolerance:5e-5,maximumMetricError,metricTolerance:2e-6,originalDataPreserved:true,
  note:'Independent JS native BN inference and ordinary folded runtime weights. All rankings must agree. No training/evaluation statistic updates.'};
await writeFile(`${directory}/independent-inference.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:true,checks:checks.length,maximumFoldScoreError,maximumMetricError}));
