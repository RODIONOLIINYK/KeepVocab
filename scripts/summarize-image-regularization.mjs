import { writeFile } from 'node:fs/promises';
import { readJsonFile } from './lib/json-files.mjs';
import { pairedShiftDifference } from './lib/image-meaning-shift.mjs';
const directory=process.argv[2]||'work/image-regularization',report=await readJsonFile(`${directory}/report.json.gz`);
const means=rows=>Object.fromEntries(['chosenAt1','loss','galleryCrossEntropy','pairwiseAccuracy','brier'].map(key=>[key,rows.reduce((n,r)=>n+r[key],0)/rows.length]));
const summaries=[],paired=[];
for(const arm of report.protocol.arms)for(const family of report.protocol.families){
  const runs=report.runs.filter(r=>r.config.arm===arm&&r.config.family===family);
  summaries.push({arm,family,strength:report.selection?.families?.[family]?.strength??runs[0].config.strength,selectedEpochs:runs.map(r=>r.selectedEpoch),
    selected:Object.fromEntries(['train','validation','test'].map(split=>[split,means(runs.map(r=>r.metrics[split].selected))])),
    last:Object.fromEntries(['train','validation','test'].map(split=>[split,means(runs.map(r=>r.metrics[split].last))])),
    selectedTestCounts:runs.map(r=>r.metrics.test.selected.chosenAt1),lastTestCounts:runs.map(r=>r.metrics.test.last.chosenAt1)});
  const averaged=(family,checkpoint)=>({rows:report.clipTest.rows.map((row,i)=>{
    const group=report.runs.filter(r=>r.config.arm===arm&&r.config.family===family);
    return{...row,chosenAt1:group.reduce((n,r)=>n+r.metrics.test[checkpoint].rows[i].chosenAt1,0)/group.length,
      loss:group.reduce((n,r)=>n+r.metrics.test[checkpoint].rows[i].loss,0)/group.length};
  })});
  for(const checkpoint of ['selected','last']){
    const result=pairedShiftDifference(averaged('baseline',checkpoint),averaged(family,checkpoint));
    result.exactDiscordanceP=null;result.noObservedDiscordance=null;result.zeroDiscordanceUpper95=null;
    result.note+=' Seed-averaged rows; same21meanings acrossseeds, not63independentexamples. Degenerate intervals do not prove equivalence.';
    paired.push({arm,family,checkpoint,...result});
  }
}
const value={summaries,paired,clipCorrect:report.clipTest.chosenAt1,testGalleries:report.primaryTestSize,activated:false};
await writeFile(`${directory}/summary.json`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify(summaries.map(r=>({arm:r.arm,family:r.family,l2:r.strength,selected:r.selectedTestCounts,last:r.lastTestCounts})),null,2));
