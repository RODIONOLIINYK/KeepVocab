import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateImagePipeline} from '../js/services/imageEvaluation.js';
import {normalizeImageEvent} from '../js/services/imageLearningHistory.js';
const vector=axis=>Array.from({length:512},(_,i)=>Number(i===axis));
test('public meaning-correctness examples and ordinary personal choices keep different learning tasks through encoding and archive normalization',async()=>{
 const item={id:'case',meaningId:'run',word:{word:'run',definition:'Move quickly on foot.'},candidates:[{id:'a',url:'https://images.test/a'},{id:'b',url:'https://images.test/b'}],feedback:{selected:['a'],wrong:['b']}};
 for(const targetTask of ['semantic','preference']){
  const report=await evaluateImagePipeline({targetTask,cases:[item]},{embedTexts:async texts=>texts.map(()=>vector(0)),embedImage:async p=>vector(p.id==='a'?0:1)});
  assert.equal(report.targetTask,targetTask);assert.equal(report.events[0].task,targetTask);assert.equal(normalizeImageEvent(report.events[0]).task,targetTask);
 }
});
