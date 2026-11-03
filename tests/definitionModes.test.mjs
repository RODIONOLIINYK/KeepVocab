import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWordDetails} from '../js/services/dictionaryApi.js';
import {consolidateEntrySenses} from '../js/services/localSenseGrouping.js';
import {entrySensesForMode} from '../js/services/learningDefinitions.js';
import {bulkResultToWord} from '../js/services/bulkWords.js';
import {MemoryStorage} from '../js/services/driveSync.js';
import {CLIP_DIMENSION} from '../js/ml/clipConfig.js';
const basis = i => Array.from({length:CLIP_DIMENSION},(_,j)=>Number(i===j));

test('Raw preserves dictionary order, exact text, duplicate senses and POS, including filtered historical entries',async()=>{
 const definitions=['The activity of imparting and acquiring skills.','The result of good social upbringing.','  An old sense, exactly as supplied.  ','The activity of imparting and acquiring skills.'];
 const payload={word:'training',entries:[{partOfSpeech:'noun',senses:definitions.map((definition,i)=>({definition,tags:i===2?['obsolete']:[]}))},{partOfSpeech:'verb',senses:[{definition:'present participle and gerund of train'}]}]};
 const storage=new MemoryStorage();
 const entry=await fetchWordDetails('training',{storage,fetchImpl:async()=>({ok:true,json:async()=>payload})});
 assert.deepEqual(entrySensesForMode(entry,'raw').map(s=>s.definition),[...definitions,'present participle and gerund of train']);
 const grouped=await consolidateEntrySenses(entry,{storage,encodeDefinitionTexts:async texts=>texts.map((_,i)=>basis(i))});
 assert.equal(grouped.senses.flatMap(s=>s.groupedSenses).length,5);
 assert.ok(grouped.senses.some(s=>s.definition==='The result of good social upbringing.'));
 assert.ok(grouped.senses.every(s=>new Set(s.groupedSenses.map(o=>o.partOfSpeech)).size===1));
 const cached=await fetchWordDetails('training',{storage,fetchImpl:()=>assert.fail('Use dictionary cache')});
 assert.deepEqual(entrySensesForMode(cached,'raw'),entry.rawDictionarySenses);
 const raw=bulkResultToWord({status:'ready',data:grouped,meaningMode:'raw'},4);
 assert.equal(raw.partOfSpeech,'verb');assert.equal(raw.definition,'present participle and gerund of train');
 assert.equal(raw.groupedSenses.length,0);
 const original=bulkResultToWord({status:'ready',data:grouped,meaningMode:'raw'},2);
 assert.equal(original.definition,definitions[2]);
});

test('high caption similarity keeps distinct skills and upbringing senses separate across POS',async()=>{
 const result=await consolidateEntrySenses({word:'training',senses:[
 {partOfSpeech:'noun',definition:'The activity of imparting and acquiring skills.'},
 {partOfSpeech:'noun',definition:'The result of good social upbringing.'},
 {partOfSpeech:'verb',definition:'present participle and gerund of train'}
 ]},{storage:new MemoryStorage(),encodeDefinitionTexts:async texts=>texts.map(()=>basis(0))});
 assert.equal(result.senses.length,3);
 assert.ok(result.senses.some(s=>s.definition==='The activity of imparting and acquiring skills.'));
 assert.ok(result.senses.some(s=>s.definition==='The result of good social upbringing.'));
 assert.equal(result.senses.find(s=>s.partOfSpeech==='verb').groupedSenses.length,1);
});

test('AI supplied missing meanings are never presented as raw dictionary definitions',()=>{
 assert.deepEqual(entrySensesForMode({aiGenerated:true,senses:[{definition:'A generated suggestion.'}]},'raw'),[]);
});
