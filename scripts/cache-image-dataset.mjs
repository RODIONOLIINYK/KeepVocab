// Encode public photos/text while independent visual QA runs. No ranking or labels.
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {imageEvaluationRuntime} from './image-evaluation-runtime.mjs';
import {imageClipPrompts} from '../js/services/imageLearning.js';
const file=process.argv[2];if(!file)throw new Error('Usage: node scripts/cache-image-dataset.mjs cases.json [--download-model]');
const fixture=JSON.parse(await readFile(file,'utf8')),runtime=await imageEvaluationRuntime({directory:dirname(resolve(file)),allowDownloads:process.argv.includes('--download-model')});
try{
 const photos=[...new Map(fixture.cases.flatMap(c=>c.candidates).map(p=>[p.id,p])).values()];
 for(let i=0;i<photos.length;i++){await runtime.embedImage(photos[i]);if((i+1)%50===0||i===photos.length-1)console.log(JSON.stringify({stage:'image-encoding-only',completed:i+1,total:photos.length}));}
 const texts=[...new Set(fixture.cases.flatMap(c=>imageClipPrompts(c.word).texts))];
 for(let i=0;i<texts.length;i++){await runtime.embedTexts([texts[i]]);if((i+1)%50===0||i===texts.length-1)console.log(JSON.stringify({stage:'text-encoding-only',completed:i+1,total:texts.length}));}
}finally{await runtime.dispose();}
