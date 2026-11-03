import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { consolidateEntrySenses } from '../js/services/localSenseGrouping.js';
import { allEntrySenses } from '../js/services/learningDefinitions.js';
import { fetchWordEntry, prepareBulkLearnerExplanations, wordEntryToWord } from '../js/services/wordEntry.js';
import { bulkResultToWord } from '../js/services/bulkWords.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';
import { CLIP_DIMENSION } from '../js/ml/clipConfig.js';
const plastic=JSON.parse(await readFile(new URL('./fixtures/learner-meaning-consolidation/plastic.json',import.meta.url)));
const reference=s=>/\bsynonym of\b/i.test(s.sourceDefinition||s.definition);
function setup(fixture=plastic, transform=x=>x){
 const storage=new MemoryStorage(),calls=[];
 saveGeminiSettings({apiKey:'validation-key-not-a-real-api-key',textModel:fixture.model},storage,{silent:true});
 return {storage,calls,fetchImpl:async(_url,request)=>{
  const body=JSON.parse(request.body);calls.push(body);
  const parts=JSON.parse(body.contents[0].parts[0].text.split('Parts: ')[1]);
  const originalIds=fixture.entry.senses.map((sense,index)=>reference(sense)?null:index).filter(index=>index!==null);
  const groups=structuredClone(fixture.groups).map(group=>({...group,members:group.members.map(id=>String(originalIds[Number(id)]))}));
  fixture.entry.senses.forEach((sense,index)=>{if(reference(sense))groups.push({members:[String(index)],definition:sense.definition,usageNote:''});});
  const response={parts:Object.fromEntries(parts.map(p=>[p.id,groups.filter(g=>g.members.every(id=>p.senses.some(s=>s.id===id)))]))};
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(transform(response))}]}}]})};
 }};
}

test('plastic uses semantic groups within POS, with all choices visible and every original recoverable',async()=>{
 const options=setup(),before=structuredClone(plastic.entry);
 const result=await consolidateEntrySenses(plastic.entry,options);
 assert.equal(result.senses.length,9);
 assert.equal(result.senseConsolidation.originalCount,13);
 const originals=allEntrySenses(result).flatMap(s=>s.groupedSenses);
 assert.equal(originals.length,13);assert.equal(new Set(originals.map(s=>s.id)).size,13);
 for(const group of allEntrySenses(result))assert.equal(new Set(group.groupedSenses.map(s=>s.partOfSpeech)).size,1);
 assert.ok(result.senses.some(s=>s.partOfSpeech==='adjective'&&s.groupedSenses.length>1));
 assert.ok(result.senses.some(s=>s.partOfSpeech==='adjective'&&s.groupedSenses.length===2));
 const unresolved=result.senses.find(s=>reference(s));
 assert.equal(unresolved.definition,plastic.entry.senses.find(reference).definition);
 assert.deepEqual(plastic.entry,before);
 assert.equal(options.calls.length,1);
 const schema=options.calls[0].generationConfig.responseSchema.properties.parts.properties;
 const enums=Object.values(schema).map(s=>s.items.properties.members.items.enum);
 assert.ok(enums.every((ids,i)=>enums.every((other,j)=>i===j||ids.every(id=>!other.includes(id)))));
});

test('cache reuse preserves grouping without another request, and changing exact source invalidates it',async()=>{
 const options=setup();const first=await consolidateEntrySenses(plastic.entry,options);
 const second=await consolidateEntrySenses(plastic.entry,{...options,fetchImpl:()=>assert.fail('Use exact grouping cache')});
 assert.deepEqual(second,first);assert.equal(options.calls.length,1);
 const changed=structuredClone(plastic.entry);changed.senses[0].definition+=' Additional source qualification.';changed.senses[0].sourceDefinition=changed.senses[0].definition;
 await consolidateEntrySenses(changed,options);assert.equal(options.calls.length,2);
});

test('cross-POS, omitted or duplicate model members fail closed and do not erase dictionary meanings',async()=>{
 for(const change of [response=>{
  const parts=Object.values(response.parts);const other=parts[1].shift();parts[0][0].members.push(...other.members);return response;
 },response=>{Object.values(response.parts)[0].shift();return response;},response=>{const g=Object.values(response.parts)[0][0];g.members.push(g.members[0]);return response;}]){
  const options=setup(plastic,change);const result=await consolidateEntrySenses(plastic.entry,options);
  assert.equal(allEntrySenses(result).length,13);assert.ok(result.consolidationWarning);assert.equal(result.senseConsolidation.source,'local');
 }
});

test('full lookup, bulk specialized selection and persisted originals keep the selected exact group',async()=>{
 const options=setup();options.storage.setItem('keepvocab_dictionary_cache_v5',JSON.stringify({plastic:{cachedAt:Date.now(),data:plastic.entry}}));
 const entry=await fetchWordEntry('plastic','english',{...options,translationLanguage:'en'});
 assert.equal(entry.senses.length,9,entry.consolidationWarning);assert.equal(options.calls.length,1,'Consolidation replaces another explanation pass');
 const index=entry.senses.length-1;
 const expected=allEntrySenses(entry)[index];
 assert.equal(bulkResultToWord({status:'ready',data:entry},index).definition,expected.definition);
 assert.equal(wordEntryToWord(entry,index).definition,expected.definition);
 const prepared=await prepareBulkLearnerExplanations([{status:'ready',data:entry,selectedSenseIndex:index}],{fetchImpl:()=>assert.fail('Grouped senses need no paid rewrite')});
 assert.equal(allEntrySenses(prepared[0].data)[index].definition,expected.definition);
 const service=new DriveSyncService(new MemoryStorage());
 const grouped=entry.senses.find(s=>s.groupedSenses.length>1);const saved=service.addWord(wordEntryToWord({...entry,senses:[grouped],additionalSenses:[]}));
 assert.equal(service.getWords().find(w=>w.id===saved.id).groupedSenses.length,grouped.groupedSenses.length);
});

test('unconfigured or disabled consolidation uses local dictionary fallback without a paid request',async()=>{
 for(const options of [{storage:new MemoryStorage()},{...setup(),consolidateSenses:false}]){
  const result=await consolidateEntrySenses(plastic.entry,{...options,fetchImpl:()=>assert.fail('No new API request')});
  assert.equal(allEntrySenses(result).length,13);
 }
});

const basis=(index)=>Array.from({length:CLIP_DIMENSION},(_,i)=>Number(i===index));
const probe={word:'grouping-probe',senses:[
 {id:'a',partOfSpeech:'adjective',definition:'Paying careful attention to details.'},
 {id:'b',partOfSpeech:'adjective',definition:'Paying close careful attention to details.'},
 {id:'c',partOfSpeech:'adjective',definition:'Able to bend repeatedly.'},
 {id:'d',partOfSpeech:'adjective',definition:'Flexible and easy to bend.'}
]};
const probeFixture={entry:probe,model:plastic.model,groups:[
 {members:['0','1'],priority:'core',definition:'Careful about details.',usageNote:''},
 {members:['2','3'],priority:'core',definition:'Able to bend easily.',usageNote:''}
]};
test('Gemini grouping runs only for at least four inputs and zero local merges',async()=>{
 const stalled=setup(probeFixture);
 const grouped=await consolidateEntrySenses(probe,{...stalled,encodeDefinitionTexts:async()=>probe.senses.map((_,i)=>basis(i))});
 assert.equal(stalled.calls.length,1);assert.equal(grouped.senses.length,2);
 assert.doesNotMatch(stalled.calls[0].contents[0].parts[0].text,/hydrocarbon|payment cards|malleable|Plastic Paddy/i);
 const short=setup(probeFixture);
 await consolidateEntrySenses({...probe,senses:probe.senses.slice(0,3)},{...short,encodeDefinitionTexts:async()=>[basis(0),basis(1),basis(2)]});
 assert.equal(short.calls.length,0);
 const merged=setup(probeFixture);
 const local=await consolidateEntrySenses(probe,{...merged,encodeDefinitionTexts:async()=>[basis(0),basis(0),basis(1),basis(2)]});
 assert.equal(merged.calls.length,0);assert.equal(allEntrySenses(local).length,3);
});
test('ordinary bulk dictionary preparation makes no automatic Gemini wording request',async()=>{
 const rows=[{status:'ready',data:{word:'careful',senses:[{definition:'Characterized by close attention to details.'}]}}];
 await prepareBulkLearnerExplanations(rows,{...setup(),fetchImpl:()=>assert.fail('No implicit AI wording request')});
});

test('training uses the recorded Gemini fallback to merge the action gloss with skills, keeping upbringing and POS distinct',async()=>{
 const training=JSON.parse(await readFile(new URL('./fixtures/learner-meaning-consolidation/training.json',import.meta.url)));
 const options=setup(training);
 const result=await consolidateEntrySenses(training.entry,{...options,encodeDefinitionTexts:async texts=>texts.map((_,i)=>basis(i))});
 assert.equal(options.calls.length,1);assert.equal(result.senses.length,5);
 const merged=result.senses.find(s=>s.groupedSenses.length===2);
 assert.deepEqual(merged.groupedSenses.map(s=>s.definition),['Action of the verb to train.','The activity of imparting and acquiring skills.']);
 assert.ok(result.senses.some(s=>s.definition==='The result of good social upbringing.'));
 assert.equal(allEntrySenses(result).flatMap(s=>s.groupedSenses).length,6);
 assert.ok(result.senses.every(s=>new Set(s.groupedSenses.map(original=>original.partOfSpeech)).size===1));
 assert.deepEqual(result.rawDictionarySenses,training.entry.rawDictionarySenses);
});
