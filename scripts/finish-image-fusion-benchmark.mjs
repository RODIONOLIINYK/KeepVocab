// Resume diagnostics after a completed fixed fusion fit; never retune on test.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark } from './lib/image-pretraining-benchmark.mjs';
import { trainingMetrics, gradientDiagnostic, fixedLabelBiasVariance } from './lib/image-training-diagnostics.mjs';
import { createPersonalizer, fitImagePersonalizer, trainImagePersonalizer } from './lib/image-personalizer-v2.mjs';
import { IMAGE_TRAINING_RECIPE } from '../js/ml/imageTrainingRecipe.js';

const args=process.argv.slice(2),flag=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const directory=resolve(flag('directory')||'work/mlp-fusion-v2/results');
const report=await readJsonFile(resolve(directory,'training-report.json')),protocol=await readJsonFile(resolve(directory,'protocol.json'));
const recipe=report.recipe,encoded=await readJsonFile('tests/fixtures/image-pretraining-fp16/embeddings.json.gz');
const manifestText=await readFile('tests/fixtures/image-pretraining-v2/cases.json','utf8'),manifest=JSON.parse(manifestText);
const sha=value=>createHash('sha256').update(value).digest('hex');
const serialize=value=>JSON.stringify(value,(_k,v)=>ArrayBuffer.isView(v)?Array.from(v):v,2)+'\n';
const save=(name,value)=>writeFile(resolve(directory,name),serialize(value));
const log=(phase,detail={})=>process.stderr.write(JSON.stringify({phase,...detail})+'\n');
if(sha(JSON.stringify(encoded.events))!==report.eventsSha256||sha(manifestText)!==report.manifestSha256
  ||sha(JSON.stringify(recipe))!==report.recipeSha256||JSON.stringify(IMAGE_TRAINING_RECIPE)!==JSON.stringify(recipe))throw Error('Dataset or shared recipe changed.');
const validated=validatePretrainingBenchmark(encoded,manifest),{split,cases}=validated;
const weightHash=model=>{const bytes=Buffer.alloc(model.weights.length*4);model.weights.forEach((v,i)=>bytes.writeFloatLE(v,i*4));return sha(bytes);};
const initial=()=>({...createPersonalizer(protocol.initializationSeed),role:'semantic'});

if(args.includes('--replay')){
  const result=trainImagePersonalizer(encoded.events,null,{...recipe,task:'semantic',datasetPartitions:validated.datasetPartitions,returnCandidate:true});
  const selected=result.model||result.candidate,last=result.lastCandidate;
  const replay={passed:weightHash(selected)===report.candidateWeightsSha256&&weightHash(last)===report.lastCandidateWeightsSha256,
    selectedWeightsSha256:weightHash(selected),lastWeightsSha256:weightHash(last),recipeSha256:sha(JSON.stringify(recipe)),
    note:'The current production training entry point reproduced both recorded offline checkpoints with the same shared recipe.'};
  await save('production-replay.json',replay);if(!replay.passed)throw Error('Production replay changed weights.');
  const probe=initial();for(let i=49808;i<probe.weights.length;i++)probe.weights[i]+=.03*Math.sin(i);
  const gradient=gradientDiagnostic(probe,split.train.slice(0,8),{epsilon:.001});
  await save('gradient-check.json',gradient);if(!gradient.passed)throw Error('Gradient check failed.');
  log('production-replay-passed',replay);process.exit(0);
}

if(args.includes('--aggregate')){
  const segments=await Promise.all([0,8].map(start=>readJsonFile(resolve(directory,`bootstrap-${start}.json`))));
  if(segments.some(row=>row.recipeSha256!==report.recipeSha256||row.eventsSha256!==report.eventsSha256))throw Error('Bootstrap provenance mismatch.');
  const rows=segments.flatMap(row=>row.rows).sort((a,b)=>a.repeat-b.repeat);
  if(rows.length!==protocol.biasVariance.bootstrapModels||rows.some((row,index)=>row.repeat!==index))throw Error('Missing/duplicate bootstrap fit.');
  const selected=await readJsonFile(resolve(directory,'candidate.json.gz'));
  const reference=trainingMetrics(selected.model,split.test,cases,{predictions:true});
  const predictions=rows.map(row=>row.probabilities),lastPredictions=rows.map(row=>row.lastProbabilities);
  const decomposition={...fixedLabelBiasVariance(predictions,reference.predictionWeights),recipe,recipeSha256:report.recipeSha256,
    bootstrap:rows.map(({probabilities:_p,lastProbabilities:_lp,...summary})=>summary),predictionRuns:predictions,predictionWeights:reference.predictionWeights,protocol:protocol.biasVariance,
    lastCheckpoint:{...fixedLabelBiasVariance(lastPredictions,reference.predictionWeights),predictionRuns:lastPredictions},
    note:'Selected checkpoints and final fitted checkpoints are decomposed separately; fixed-label Brier identity does not identify true Bayes bias or label noise.'};
  await save('bias-variance.json',decomposition);log('bootstrap-aggregated',{models:rows.length,selectedError:decomposition.expectedBrierError,lastError:decomposition.lastCheckpoint.expectedBrierError});process.exit(0);
}

const start=Number(flag('start')),count=Number(flag('count')||8);
if(!Number.isInteger(start)||start<0||!Number.isInteger(count)||count<1||start+count>protocol.biasVariance.bootstrapModels)throw Error('Specify --replay, --aggregate or a valid --start=N --count=N segment.');
const families=new Map();for(const d of split.train){const key=cases.get(d.id).familyId||d.meaningId;if(!families.has(key))families.set(key,[]);families.get(key).push(d);}
const groups=[...families.entries()],rows=[];
for(let repeat=start;repeat<start+count;repeat++){
  let seed=protocol.biasVariance.bootstrapSeed+repeat*7919;
  const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return(seed>>>0)/4294967296;};
  const sampled=Array.from({length:groups.length},()=>groups[Math.floor(random()*groups.length)]);
  let selected,selectedEpoch=0,best=null;
  const fitted=fitImagePersonalizer(initial(),sampled.flatMap(([,items])=>items),split.validation,{...recipe,observeEpoch:(model,state)=>{
    const metric=trainingMetrics(model,split.validation,cases);
    if(!best||metric.chosenAt1>best.chosenAt1||metric.chosenAt1===best.chosenAt1&&metric.loss<best.loss-1e-12){best=metric;selected={...model,weights:Float32Array.from(model.weights)};selectedEpoch=state.epoch;}
  }});
  const a=trainingMetrics(selected,split.test,cases,{predictions:true}),b=trainingMetrics(fitted.model,split.test,cases,{predictions:true});
  const {probabilities,predictionWeights:_aw,...metrics}=a,{probabilities:lastProbabilities,predictionWeights:_bw,...lastMetrics}=b;
  rows.push({repeat,sampledFamilies:sampled.map(([id])=>id),epochsRun:fitted.epochsRun,selectedEpoch,metrics,lastMetrics,probabilities,lastProbabilities});
  await save(`bootstrap-${start}.json`,{start,count,completed:rows.length,recipeSha256:report.recipeSha256,eventsSha256:report.eventsSha256,rows});
  log('bootstrap-segment',{start,completed:rows.length,count,repeat,selectedEpoch,selectedMatches:metrics.chosenAt1,lastMatches:lastMetrics.chosenAt1,epochsRun:fitted.epochsRun});
}
