import { writeFile } from 'node:fs/promises';
import { readJsonFile } from './lib/json-files.mjs';
import { pairedShiftDifference } from './lib/image-meaning-shift.mjs';
const parent=await readJsonFile('work/image-regularization/report.json.gz');
const studies=[['input-scaling',await readJsonFile('work/image-input-scaling/report.json.gz')],['interaction-ablation',await readJsonFile('work/image-interaction-ablation/report.json.gz')]];
const mean=rows=>Object.fromEntries(['chosenAt1','loss','galleryCrossEntropy','pairwiseAccuracy','brier'].map(key=>[key,rows.reduce((n,r)=>n+r[key],0)/rows.length]));
const summaries=[],comparisons=[];
for(const [study,report]of studies){
  const cohorts=report.cohorts||Object.fromEntries(report.protocol.families.map(f=>[f,report.runs.filter(r=>r.config.family===f).map(r=>r.config.name)]));
  for(const [cohort,names]of Object.entries(cohorts))for(const arm of report.protocol.arms){
    const runs=names.map(name=>report.runs.find(r=>r.config.name===name)).filter(r=>r.config.arm===arm).sort((a,b)=>a.config.seed-b.config.seed);
    const family=runs[0].config.family,referenceFamily=study==='interaction-ablation'?family:family.includes('l2')?'l2':'baseline';
    const reference=parent.runs.filter(r=>r.config.arm===arm&&r.config.family===referenceFamily).sort((a,b)=>a.config.seed-b.config.seed);
    summaries.push({study,cohort,arm,referenceFamily,learningRate:runs[0].config.learningRate??report.protocol.recipe.learningRate,
      strength:runs[0].config.strength,selectedEpochs:runs.map(r=>r.selectedEpoch),
      selected:Object.fromEntries(['train','validation','test'].map(split=>[split,mean(runs.map(r=>r.metrics[split].selected))])),
      last:Object.fromEntries(['train','validation','test'].map(split=>[split,mean(runs.map(r=>r.metrics[split].last))])),
      selectedTestCounts:runs.map(r=>r.metrics.test.selected.chosenAt1),lastTestCounts:runs.map(r=>r.metrics.test.last.chosenAt1)});
    const averaged=(rows,checkpoint)=>({rows:rows[0].metrics.test[checkpoint].rows.map((row,i)=>({...row,
      chosenAt1:rows.reduce((n,r)=>n+r.metrics.test[checkpoint].rows[i].chosenAt1,0)/rows.length,
      loss:rows.reduce((n,r)=>n+r.metrics.test[checkpoint].rows[i].loss,0)/rows.length}))});
    for(const checkpoint of ['selected','last']){
      const result=pairedShiftDifference(averaged(reference,checkpoint),averaged(runs,checkpoint));
      result.exactDiscordanceP=null;result.noObservedDiscordance=null;result.zeroDiscordanceUpper95=null;
      result.note+=' Exploratory follow-up, seed-averaged outcomes on the same21meanings; not independent datasets or a fresh blind test.';
      comparisons.push({study,cohort,arm,checkpoint,referenceFamily,...result});
    }
  }
}
await writeFile('work/image-regularization/followup-summary.json',JSON.stringify({summaries,comparisons,activated:false},null,2)+'\n');
console.log(JSON.stringify(summaries.map(r=>({study:r.study,cohort:r.cohort,arm:r.arm,lr:r.learningRate,selected:r.selectedTestCounts,last:r.lastTestCounts})),null,2));
