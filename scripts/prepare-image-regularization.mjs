import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark } from './lib/image-pretraining-benchmark.mjs';
import { auditMeaningShiftSplit } from './lib/image-meaning-shift.mjs';
import { createPersonalizer, fitImagePersonalizer, personalizerLossAndGradient } from '../js/services/imagePersonalizer.js';
const dir='work/image-regularization';await mkdir(dir,{recursive:true});
const protocol=await readJsonFile('docs/image-regularization-protocol.json'),plan=await readJsonFile(protocol.dataSplit);
const valid=validatePretrainingBenchmark(await readJsonFile(plan.sourceFeatures),await readJsonFile(plan.sourceManifest));
for(const arm of protocol.arms)auditMeaningShiftSplit(valid,plan,arm);
const train=auditMeaningShiftSplit(valid,plan,'seen').split.train;
const initial=createPersonalizer(protocol.pilotSeed),first=train.slice(0,8),probe=personalizerLossAndGradient(initial,first);
const recipe={...protocol.recipe,epochs:1,regularization:0,patience:Infinity,maxMilliseconds:1800000,checkpoint:'last'};
const oneBatch=fitImagePersonalizer(initial,first,first,recipe).model;
const oneEpoch=fitImagePersonalizer(initial,train,train,recipe).model;
const data={initials:Object.fromEntries(protocol.seeds.map(seed=>[seed,createPersonalizer(seed)])),
  parity:{ids:first.map(row=>row.id),trainIds:train.map(row=>row.id),loss:probe.loss,gradient:probe.gradient,oneBatch,oneEpoch},
  provenance:{protocolSha256:createHash('sha256').update(await readFile('docs/image-regularization-protocol.json')).digest('hex'),
    splitSha256:createHash('sha256').update(await readFile(protocol.dataSplit)).digest('hex'),
    productionSourceSha256:createHash('sha256').update(await readFile('js/services/imagePersonalizer.js')).digest('hex')}};
await writeFile(`${dir}/prepared.json.gz`,gzipSync(JSON.stringify(data,(_key,v)=>ArrayBuffer.isView(v)?Array.from(v):v)));
console.log('Validated both preserved splits; saved exact JS initialization, gradients, one-batch and one-epoch reference.');
