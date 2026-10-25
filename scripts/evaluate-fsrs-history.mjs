// Read-only offline comparison. Does not modify the app or activate weights.
import { readFile, writeFile } from 'node:fs/promises';
import { mergeReviewEvents } from '../js/services/reviewHistory.js';
import { FSRS_DEFAULT_WEIGHTS, validFsrsWeights } from '../js/services/fsrsConfig.js';
import { predictReviewHistory, predictionMetrics, optimizeFsrsChannel } from '../js/services/fsrsOptimizer.js';
const args=process.argv.slice(2), file=args.find(a=>!a.startsWith('--'));
if(!file)throw new Error('Usage: node scripts/evaluate-fsrs-history.mjs reviews.json [--candidate=weights.json] [--fit] [--output=report.json]');
const input=JSON.parse(await readFile(file,'utf8')), events=mergeReviewEvents(Array.isArray(input)?input:input.records||input.events||[]);
const candidateFile=args.find(a=>a.startsWith('--candidate='))?.slice(12);
const candidate=candidateFile?JSON.parse(await readFile(candidateFile,'utf8')):null;
const weights=candidate?.weights||candidate;
if(weights&&!validFsrsWeights(weights))throw new Error('Expected 21 valid FSRS-6 parameters.');
const report={algorithm:'FSRS-6',reviews:events.length,partition:'chronological last 20% per channel',channels:{},note:'An externally supplied candidate must be trained without these later answers. This tool alone cannot verify its provenance.'};
for(const channel of ['recall','recognition','assisted']){
  const history=events.filter(e=>e.channel===channel), all=predictReviewHistory(history,FSRS_DEFAULT_WEIGHTS);
  if(!all.length){report.channels[channel]={observations:0};continue;}
  const cutoff=Date.parse(all[Math.max(0,Math.floor(all.length*.8)-1)].event.occurredAt);
  const later=predictReviewHistory(history,FSRS_DEFAULT_WEIGHTS,cutoff).filter(p=>!p.training);
  report.channels[channel]={observations:all.length,baseline:predictionMetrics(later),
    ...(weights?{candidate:predictionMetrics(predictReviewHistory(history,weights,cutoff).filter(p=>!p.training),candidate.calibration)}:{}),
    ...(args.includes('--fit')?{fitted:optimizeFsrsChannel(history,channel)}:{})};
}
const output=args.find(a=>a.startsWith('--output='))?.slice(9);
if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
