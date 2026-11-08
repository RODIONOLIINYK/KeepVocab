import test from 'node:test';import assert from 'node:assert/strict';
import {groupEntrySensesLocally} from '../js/services/localSenseGrouping.js';
import {remapMeaningDrafts} from '../js/components/AddWordModal.js';
const sense=(id,definition,partOfSpeech='noun',word='probe')=>({id,word,definition,sourceDefinition:definition,partOfSpeech});
test('former content-specific shortcuts now send paraphrases to the encoder',async()=>{
 for(const [word,pos,definitions]of [
 ['apple','noun',['A common, firm, round fruit produced by a tree of the genus Malus.','The fruit of the tree Malus domestica, chiefly with a green, red, or yellow skin, cultivated in temperate climates for cidermaking, cooking, and eating.']],
 ['banana','noun',['A long yellow fruit produced by a plant of the genus Musa.','The fruit of the plant Musa acuminata, cultivated for eating.']],
 ['charge','verb',['(transitive) To replenish energy to (a battery, or a device containing a battery) by use of an electrical device plugged into a power outlet.','(intransitive, of a battery or a device containing a battery) To replenish energy.']],
 ['run','verb',['(intransitive) Of a machine, including computer programs, to be operating or working normally.','(transitive) To make a machine operate.']]
 ]){
  const senses=definitions.map((d,i)=>sense(String(i),d,pos,word));
  let sent = 0;
  const result = await groupEntrySensesLocally({ word, senses }, { storage: null, encodeDefinitionTexts: async texts => { sent = texts.length; return null; } });
  assert.equal(sent, 2, word);
  assert.deepEqual(result.senses.flatMap(sense => sense.groupedSenses), senses);
 }
});
test('regrouping keeps selection and manual fields attached to original senses without duplicating merged edits on split',()=>{
 const a=sense('a','First meaning.'),b=sense('b','Equivalent wording.'),c=sense('c','Another meaning.');
 const edited={...a,definition:'My edited definition.',example:'An edited example.',translation:'My translation.'};
 const combined={...a,id:'merged',groupedSenses:[a,b]};
 const state=remapMeaningDrafts({drafts:[edited,b,c],selected:new Set(['a','c']),focused:'a'},[combined,c]);
 assert.deepEqual([...state.selected],['merged','c']);assert.equal(state.focused,'merged');assert.equal(state.drafts.get('merged').definition,edited.definition);assert.deepEqual(state.drafts.get('merged').groupedSenses,[a,b]);
 const split=remapMeaningDrafts({drafts:[{...combined,definition:'Edited combined definition.'}],selected:new Set(['merged']),focused:'merged'},[a,b]);
 assert.deepEqual([...split.selected],['a','b']);assert.equal(split.drafts.get('a').definition,a.definition);assert.equal(split.drafts.get('b').definition,b.definition);
});
test('only unresolved senses with the same part of speech are sent to the encoder',async()=>{
 const senses=[sense('a','A reasonable explanation supported by facts and evidence.','adjective'),sense('b','A reasonable explanation supported by facts and observations.','adjective'),sense('unrelated','A container for water.','noun')];
 let texts=[];await groupEntrySensesLocally({word:'probe',senses},{storage:null,encodeDefinitionTexts:async input=>{texts=input;return null;}});
 assert.equal(texts.length,2);assert.ok(!texts.includes(senses[2].definition));
});

test('regrouping a cached entry neither duplicates originals nor loses a source',async()=>{
 const {consolidateEntrySenses}=await import('../js/services/localSenseGrouping.js');
 const a=sense('a','To produce as a result.','verb'),b=sense('b','(US) To produce as a result.','verb'),c=sense('c','To give way under force.','verb');
 const input={word:'probe',senses:[a,b,c],rawDictionarySenses:[a,b,c]};
 const options={storage:null,encodeDefinitionTexts:async()=>null};
 const first=await consolidateEntrySenses(input,options),second=await consolidateEntrySenses(first,options);
 assert.equal(second.senseConsolidation.originalCount,3);assert.equal(second.senses.length,2);assert.deepEqual(second.senses.flatMap(s=>s.groupedSenses.map(s=>s.id)).sort(),['a','b','c']);
});

test('additional source glosses survive regrouping alongside the raw dictionary snapshot',async()=>{
 const {consolidateEntrySenses}=await import('../js/services/localSenseGrouping.js');
 const a=sense('raw-a','An accusation.'),b=sense('extra-b','An accusation by a person or organization.');
 const grouped={...a,groupedSenses:[a,b]};
 const input={word:'probe',rawDictionarySenses:[a],senses:[grouped]};
 const result=await consolidateEntrySenses(input,{storage:null,encodeDefinitionTexts:async()=>null});
 assert.equal(result.senseConsolidation.originalCount,2);assert.deepEqual(result.senses.flatMap(s => s.sourceDefinitions),[a.definition,b.definition]);
});

test('Library merge uses persisted IDs, uses matching words, and retains originals and review counts',async()=>{
 const {duplicateMeaningGroups}=await import('../js/components/LibraryView.js');
 const {DriveSyncService,MemoryStorage}=await import('../js/services/driveSync.js');
 const service=new DriveSyncService(new MemoryStorage());
 const definitions=['A common, firm, round fruit produced by a tree of the genus Malus.','(countable) A common, firm, round fruit produced by a tree of the genus Malus.'];
 const records=definitions.map((definition,i)=>service.addWord({word:'apple',partOfSpeech:'noun',definition,groupedSenses:[sense('dictionary-'+i,definition,'noun','apple')],practiceStats:{attempts:i+1,recalled:i+1}},'November 2026 Vocabulary'));
 const groups=duplicateMeaningGroups(records);assert.equal(groups.length,1);assert.deepEqual(new Set(groups[0].mergedSenseIds),new Set(records.map(r=>r.id)));assert.ok(groups[0].mergedSenseIds.every(id=>!id.startsWith('dictionary-')));
 const merged=service.mergeWordMeanings(groups[0].mergedSenseIds);assert.equal(service.getAllWords().length,1);assert.equal(merged.groupedSenses.length,2);assert.deepEqual(new Set(merged.sourceDefinitions),new Set(definitions));assert.equal(merged.practiceStats.attempts,3);
 const tree=service.addWord({word:'apple',partOfSpeech:'noun',definition:'A tree of the genus Malus, cultivated for its fruit.'},'November 2026 Vocabulary');assert.throws(()=>service.mergeWordMeanings([merged.id,tree.id]),/near-identical/);
});
