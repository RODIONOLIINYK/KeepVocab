import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark, validateSemanticSupervision, comparePretrainingModels } from './lib/image-pretraining-benchmark.mjs';
import { trainingMetrics, gradientDiagnostic, fixedLabelBiasVariance } from './lib/image-training-diagnostics.mjs';
import { createPersonalizer, fitImagePersonalizer, PERSONALIZER_VERSION, createPersonalizerScorer } from '../js/services/imagePersonalizer.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';

const args=process.argv.slice(2), flag=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const directory=resolve(flag('output-dir')||'work/mlp-fusion-v2/results'); await mkdir(directory,{recursive:true});
const protocolText=await readFile('docs/image-fusion-v2-protocol.json','utf8'), protocol=JSON.parse(protocolText);
if(protocol.personalizerVersion!==PERSONALIZER_VERSION||protocol.encoder!==CLIP_TAG)throw Error('Protocol does not match current encoder/scoring.');
const encoded=await readJsonFile('tests/fixtures/image-pretraining-fp16/embeddings.json.gz');
const manifestText=await readFile('tests/fixtures/image-pretraining-v2/cases.json','utf8'),manifest=JSON.parse(manifestText);
validateSemanticSupervision(encoded,manifest);const validated=validatePretrainingBenchmark(encoded,manifest),{split,cases}=validated;
const sha=value=>createHash('sha256').update(value).digest('hex');
const serialize=value=>JSON.stringify(value,(_k,v)=>ArrayBuffer.isView(v)?Array.from(v):v,2)+'\n';
const save=(name,value)=>writeFile(resolve(directory,name),serialize(value));
const compressed=(name,value)=>writeFile(resolve(directory,name),gzipSync(serialize(value)));
const log=(phase,details={})=>process.stderr.write(JSON.stringify({phase,...details})+'\n');
const better=(a,b)=>!b||a.chosenAt1>b.chosenAt1||a.chosenAt1===b.chosenAt1&&a.loss<b.loss-1e-12;
const initial=()=>({...createPersonalizer(protocol.initializationSeed),role:'semantic'});
const sources=['js/services/imagePersonalizer.js','scripts/tune-image-fusion.mjs','scripts/lib/image-training-diagnostics.mjs'];
const provenance={encoder:CLIP_TAG,personalizerVersion:PERSONALIZER_VERSION,protocolSha256:sha(protocolText),manifestSha256:sha(manifestText),eventsSha256:sha(JSON.stringify(encoded.events)),
  sourceSha256:Object.fromEntries(await Promise.all(sources.map(async file=>[file,sha(await readFile(file))]))),nodeVersion:process.version,diversity:validated.diversity};
let resumed=[];
try{
  const previous=await readJsonFile(resolve(directory,'provenance.json')),progress=await readJsonFile(resolve(directory,'pilot-progress.json'));
  if(['protocolSha256','manifestSha256','eventsSha256'].some(key=>previous[key]!==provenance[key])
    ||sources.slice().filter(name=>name!=='scripts/tune-image-fusion.mjs').some(name=>previous.sourceSha256[name]!==provenance.sourceSha256[name]))throw Error('Pilot cache belongs to different inputs or numerical fitter.');
  resumed=progress.trials||[];
  provenance.resumedPilotTrials=resumed.length;provenance.priorDriverSha256=previous.sourceSha256['scripts/tune-image-fusion.mjs'];
}catch(error){if(error.code!=='ENOENT')throw error;}
await save('protocol.json',protocol);await save('provenance.json',provenance);

// Both final runs call precisely this function with the same recipe. The tiny
// run supplies its training batch as selection data only to test memorization.
function run(recipe,train,selection,{capture=false,tag='fit',quiet=false}={}){
  const curve=[],snapshots=[];let selected,selectedEpoch=0,selectedMetrics=null;
  const fitted=fitImagePersonalizer(initial(),train,selection,{...recipe,observeEpoch:(model,state)=>{
    const trainMetrics=trainingMetrics(model,train,cases),selectionMetrics=trainingMetrics(model,selection,cases);
    const row={...state,train:trainMetrics,selection:selectionMetrics};curve.push(row);
    if(better(selectionMetrics,selectedMetrics)){
      selected={...model,weights:Float32Array.from(model.weights)};selectedEpoch=state.epoch;selectedMetrics=selectionMetrics;
    }
    if(capture&&state.epoch%10===0)snapshots.push({epoch:state.epoch,weights:Float32Array.from(model.weights)});
    if(!quiet&&state.epoch%10===0)log('epoch',{tag,epoch:state.epoch,trainLoss:trainMetrics.loss,selectionMatches:selectionMetrics.chosenAt1,selectionLoss:selectionMetrics.loss,maximumGradientNorm:state.maximumGradientNorm});
  }});
  return {recipe,recipeSha256:sha(JSON.stringify(recipe)),model:selected,lastModel:fitted.model,selectedEpoch,selectedMetrics,curve,snapshots,
    epochsRun:fitted.epochsRun,steps:fitted.steps,stoppedBy:fitted.stoppedBy,elapsedMs:fitted.elapsedMs,maximumObservedGradientNorm:fitted.maximumObservedGradientNorm,clippedSteps:fitted.clippedSteps};
}

const trials=[];let winner=null;
const configurations=protocol.pilot.learningRates.flatMap(learningRate=>protocol.pilot.batchSizes.map(batchSize=>({learningRate,batchSize,regularization:0})))
  .concat(protocol.pilot.regularizedControls);
for(const [index,configuration]of configurations.entries()){
  if(resumed[index]){
    const cached=resumed[index];
    if(['learningRate','batchSize','regularization'].some(key=>cached[key]!==configuration[key]))throw Error('Resumed pilot order/configuration mismatch.');
    trials.push(cached);
    if(configuration.regularization===0&&(better(cached.selectedValidation,winner?.selectedValidation)
      ||winner&&cached.selectedValidation.chosenAt1===winner.selectedValidation.chosenAt1&&Math.abs(cached.selectedValidation.loss-winner.selectedValidation.loss)<1e-12
        &&(cached.learningRate<winner.learningRate||cached.learningRate===winner.learningRate&&cached.batchSize>winner.batchSize)))winner=cached;
    log('pilot-resumed',{index:index+1,...configuration});continue;
  }
  const recipe={...protocol.sharedFinalRecipe,...configuration,epochs:protocol.pilot.epochs};
  log('pilot-start',{index:index+1,total:configurations.length,...configuration});
  const fitted=run(recipe,split.train,split.validation,{tag:`pilot-${index+1}`,quiet:true});
  const trial={...configuration,selectedEpoch:fitted.selectedEpoch,selectedValidation:fitted.selectedMetrics,curve:fitted.curve,
    epochsRun:fitted.epochsRun,elapsedMs:fitted.elapsedMs,maximumObservedGradientNorm:fitted.maximumObservedGradientNorm,clippedSteps:fitted.clippedSteps};
  trials.push(trial);
  if(configuration.regularization===0&&(better(trial.selectedValidation,winner?.selectedValidation)
    || winner&&trial.selectedValidation.chosenAt1===winner.selectedValidation.chosenAt1&&Math.abs(trial.selectedValidation.loss-winner.selectedValidation.loss)<1e-12
      &&(trial.learningRate<winner.learningRate||trial.learningRate===winner.learningRate&&trial.batchSize>winner.batchSize)))winner=trial;
  await save('pilot-progress.json',{completed:trials.length,total:configurations.length,trials,winner});
  log('pilot-complete',{index:index+1,...configuration,selectedEpoch:trial.selectedEpoch,matches:trial.selectedValidation.chosenAt1,loss:trial.selectedValidation.loss,epochsRun:trial.epochsRun});
}
await save('pilot-report.json',{...provenance,trials,winner,testUsed:false});
const recipe={...protocol.sharedFinalRecipe,learningRate:winner.learningRate,batchSize:winner.batchSize};
await save('selected-recipe.json',recipe);log('recipe-selected',recipe);

const baseline=trainingMetrics(null,split.train,cases,{rows:true}),mistakes=new Set(baseline.rows.filter(row=>!row.chosenAt1).map(row=>row.id));
const seenFamilies=new Set(),pool=[...split.train].sort((a,b)=>Number(mistakes.has(b.id))-Number(mistakes.has(a.id))||a.id.localeCompare(b.id));
const tiny=pool.filter(decision=>{const family=cases.get(decision.id).familyId||decision.meaningId;if(seenFamilies.has(family))return false;seenFamilies.add(family);return true;}).slice(0,recipe.batchSize);
if(tiny.length!==recipe.batchSize)throw Error('Insufficient training families for a real one-batch overfit check.');
const small=run(recipe,tiny,tiny,{tag:'small-batch'});
const smallMetrics=trainingMetrics(small.model,tiny,cases);
const {model:_tinyModel,lastModel:_tinyLast,snapshots:_tinySnapshots,...smallReport}=small;
Object.assign(smallReport,{decisionIds:tiny.map(row=>row.id),comparisons:smallMetrics.comparisons,after:smallMetrics,
  passed:smallMetrics.chosenAt1===tiny.length&&smallMetrics.pairwiseAccuracy>1-1e-12&&smallMetrics.loss<.01,
  note:'Training-only diagnostic: same batch reused as selection data. The real fit uses separate held-out validation.'});
await save('small-batch.json',smallReport);log('small-batch-complete',{passed:smallReport.passed,after:smallMetrics});
if(!smallReport.passed)throw Error('Same-recipe small-batch check failed; inspect rather than silently weaken the diagnostic.');

const full=run(recipe,split.train,split.validation,{capture:true,tag:'full-data'});
if(full.recipeSha256!==small.recipeSha256)throw Error('Small/full recipes differ.');
const candidate=full.model;
// Hyperparameters, stopping and final checkpoint are frozen before test use.
for(const point of full.snapshots){const metric=trainingMetrics({...candidate,weights:point.weights},split.test,cases);full.curve.find(row=>row.epoch===point.epoch).test=metric;}
const selectedTest=trainingMetrics(candidate,split.test,cases,{predictions:true});
full.curve.find(row=>row.epoch===full.selectedEpoch).test=trainingMetrics(candidate,split.test,cases);
const metrics=Object.fromEntries(['train','validation','test'].map(name=>[name,{
  clip:trainingMetrics(null,split[name],cases),mlp:trainingMetrics(candidate,split[name],cases,{branch:'mlp'}),fusion:trainingMetrics(candidate,split[name],cases)
}]));
const lastMetrics=Object.fromEntries(['train','validation','test'].map(name=>[name,{
  clip:trainingMetrics(null,split[name],cases),mlp:trainingMetrics(full.lastModel,split[name],cases,{branch:'mlp'}),fusion:trainingMetrics(full.lastModel,split[name],cases)
}]));
const comparison=comparePretrainingModels(validated,candidate,{bootstrapSamples:2000});
const bytes=Buffer.alloc(candidate.weights.length*4);candidate.weights.forEach((v,i)=>bytes.writeFloatLE(v,i*4));
const lastBytes=Buffer.alloc(full.lastModel.weights.length*4);full.lastModel.weights.forEach((v,i)=>lastBytes.writeFloatLE(v,i*4));
const {model:_fullModel,lastModel:_lastModel,snapshots:_fullSnapshots,...fullReport}=full;
const report={...provenance,...fullReport,metrics,lastMetrics,comparison,candidateWeightsSha256:sha(bytes),lastCandidateWeightsSha256:sha(lastBytes),sameRecipeAsOverfit:true,
  maximumGradientNormLimit:recipe.maximumGradientNorm,activated:false,testCurveUse:'Post-hoc every tenth epoch plus selected checkpoint; not used for any selection.'};
await save('training-report.json',report);await compressed('candidate.json.gz',{model:candidate,candidateWeightsSha256:sha(bytes),recipe,activated:false});
await compressed('last-candidate.json.gz',{model:full.lastModel,candidateWeightsSha256:sha(lastBytes),recipe,checkpoint:'last',activated:false});
log('full-data-complete',{selectedEpoch:full.selectedEpoch,epochsRun:full.epochsRun,metrics});
const probe=initial();for(let i=49808;i<probe.weights.length;i++)probe.weights[i]+=.03*Math.sin(i);
const gradient=gradientDiagnostic(probe,split.train.slice(0,8),{epsilon:.001});await save('gradient-check.json',gradient);
if(!gradient.passed)throw Error('Gradient check failed.');

const families=new Map();for(const decision of split.train){const key=cases.get(decision.id).familyId||decision.meaningId;if(!families.has(key))families.set(key,[]);families.get(key).push(decision);}
const groups=[...families.entries()],bootstrap=[],predictionRuns=[],lastPredictionRuns=[];
for(let repeat=0;repeat<protocol.biasVariance.bootstrapModels;repeat++){
  let seed=protocol.biasVariance.bootstrapSeed+repeat*7919;
  const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return(seed>>>0)/4294967296;};
  const sampled=Array.from({length:groups.length},()=>groups[Math.floor(random()*groups.length)]);
  const fitted=run(recipe,sampled.flatMap(([,rows])=>rows),split.validation,{quiet:true});
  const result=trainingMetrics(fitted.model,split.test,cases,{predictions:true});predictionRuns.push(result.probabilities);
  const last=trainingMetrics(fitted.lastModel,split.test,cases,{predictions:true});lastPredictionRuns.push(last.probabilities);
  const {probabilities:_p,predictionWeights:_w,...summary}=result;
  const {probabilities:_lp,predictionWeights:_lw,...lastSummary}=last;
  bootstrap.push({repeat,sampledFamilies:sampled.map(([id])=>id),epochsRun:fitted.epochsRun,selectedEpoch:fitted.selectedEpoch,metrics:summary,lastMetrics:lastSummary});
  await save('bootstrap-progress.json',{completed:bootstrap.length,total:protocol.biasVariance.bootstrapModels,bootstrap,predictionRuns,lastPredictionRuns});
  log('bootstrap',{completed:bootstrap.length,total:protocol.biasVariance.bootstrapModels,matches:result.chosenAt1,epochsRun:fitted.epochsRun});
}
const decomposition={...fixedLabelBiasVariance(predictionRuns,selectedTest.predictionWeights),recipe,recipeSha256:full.recipeSha256,
  bootstrap,predictionRuns,predictionWeights:selectedTest.predictionWeights,protocol:protocol.biasVariance,
  lastCheckpoint:{...fixedLabelBiasVariance(lastPredictionRuns,selectedTest.predictionWeights),predictionRuns:lastPredictionRuns},
  note:'Conditional fixed-label decomposition; initialization and validation fixed, families resampled. Shared training photos may create uncaptured dependence.'};
await save('bias-variance.json',decomposition);
console.log(serialize({recipe,metrics,smallBatch:{passed:smallReport.passed,loss:smallMetrics.loss},decomposition:Object.fromEntries(Object.entries(decomposition).filter(([key])=>!['bootstrap','predictionRuns','predictionWeights'].includes(key))),activated:false}));
