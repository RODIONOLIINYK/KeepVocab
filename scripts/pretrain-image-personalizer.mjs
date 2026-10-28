// Package the single, frozen semantic benchmark run. Never tune on its test set.
import { readJsonFile } from './lib/json-files.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validPersonalizer } from '../js/services/imagePersonalizer.js';
const args=process.argv.slice(2),file=args.find(a=>!a.startsWith('--'));
const flag=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
if(!file||!flag('benchmark')||!flag('candidate'))throw new Error('Usage: node scripts/pretrain-image-personalizer.mjs encoded-report.json --benchmark=benchmark.json --candidate=candidate.json');
const input=await readJsonFile(file),benchmark=await readJsonFile(flag('benchmark')),saved=await readJsonFile(flag('candidate'));
const model=saved.model;
const dataSha256=createHash('sha256').update(JSON.stringify(input.events)).digest('hex');
if(input.targetTask!=='semantic'||!input.events?.length||input.events.some(e=>e.task!=='semantic')||benchmark.dataSha256!==dataSha256||benchmark.targetTask!=='semantic')throw new Error('Semantic data and benchmark provenance do not match.');
if(!validPersonalizer(model)||model.role!=='semantic'||saved.accepted!==benchmark.accepted)throw new Error('Candidate is not the semantic model from the benchmark.');
const weights=Float32Array.from(model.weights),bytes=Buffer.alloc(weights.length*4);weights.forEach((v,i)=>bytes.writeFloatLE(v,i*4));
const weightsSha256=createHash('sha256').update(bytes).digest('hex');
if(weightsSha256!==benchmark.candidateWeightsSha256||weightsSha256!==saved.candidateWeightsSha256)throw new Error('Candidate weights differ from the frozen benchmark.');
const {datasetPartitions:_partitions,...recipe}=benchmark.recipe;
const summary={dataset:benchmark.dataset,kind:input.kind,targetTask:'semantic',encoder:input.encoder,preprocessing:input.preprocessing,
  trainingChoices:benchmark.splits.train.baseline.choices,validationChoices:benchmark.splits.validation.baseline.choices,testChoices:benchmark.splits.test.baseline.choices,
  diversity:benchmark.diversity,accepted:benchmark.accepted,
  baselineTestAgreement:benchmark.splits.test.baseline.chosenAt1/benchmark.splits.test.baseline.choices,
  rawClipTestAgreement:benchmark.splits.test.rawClip.chosenAt1/benchmark.splits.test.rawClip.choices,
  candidateTestAgreement:benchmark.splits.test.mlp.chosenAt1/benchmark.splits.test.mlp.choices,
  baselineTestLoss:benchmark.splits.test.baseline.meanPairwiseLoss,candidateTestLoss:benchmark.splits.test.mlp.meanPairwiseLoss,
  use:benchmark.accepted?'validated-semantic-head':'disabled; no rejected layers used for personal initialization',parameters:weights.length,
  dataSha256,weightsSha256,recipe,
  note:'Public-photo semantic correctness benchmark, independently visually reviewed before scoring. It does not measure any individual user’s taste.'};
const {weights:_weights,...metadata}=model;
const header=`// Generated from a frozen semantic benchmark; see docs/image-pretraining-v2-report.json.\nimport { base64ToBytes } from '../utils/base64.js';\nimport { createPreferencePersonalizer } from '../services/imagePersonalizer.js';\nexport const PRETRAINED_IMAGE_REPORT = ${JSON.stringify(summary)};\n`;
const body=benchmark.accepted?`const metadata=${JSON.stringify({...metadata,genericValidation:summary})};\nconst encoded='${bytes.toString('base64')}';\nfunction decode(){const bytes=base64ToBytes(encoded),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return {...metadata,weights:Float32Array.from({length:${weights.length}},(_,i)=>view.getFloat32(i*4,true))};}\nexport function getPretrainedImageModel(){return decode();}\nexport function getImagePersonalizerInitialization(){return createPreferencePersonalizer(decode());}\n`:`// The rejected candidate is retained only in the offline experiment, not shipped.\nexport function getPretrainedImageModel(){return null;}\nexport function getImagePersonalizerInitialization(){return null;}\n`;
await writeFile('js/ml/pretrainedImagePersonalizer.js',header+body);
await writeFile('docs/image-pretraining-v2-summary.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
