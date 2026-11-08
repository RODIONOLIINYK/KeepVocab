import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
import { areSensesNearDuplicate } from '../js/services/learningDefinitions.js';

// Exact Wiktionary/WordNet definitions from the reviewed cross-source diagnostic
// in work/meaning-merge-recall-audit.json. These are not a live-lookup benchmark.
const pairs = [
 ['goblet', 'A drinking vessel with a foot and stem.', 'a drinking glass with a base and stem'],
 ['thimble', 'As much as fills a thimble (sense 1); a thimbleful.', 'as much as a thimble will hold'],
 ['beech', 'The wood of the beech tree.', 'wood of any of various beech trees; used for flooring and containers and plywood and tool handles'],
 ['elm', 'Wood from an elm tree.', 'hard tough wood of an elm tree; used for e.g. implements and furniture'],
 ['jug', 'To stew in an earthenware jug etc.', 'stew in an earthenware jug'],
 ['spruce', 'The wood of a spruce.', 'light soft moderately strong wood of spruce trees; used especially for timbers and millwork']
];
test('source-backed paraphrases with different wording reach the encoder after removing special-case templates', async () => {
 for (const [word, left, right] of pairs) {
  const senses = [left, right].map((definition, i) => ({ id: String(i), word, definition, partOfSpeech: word === 'jug' ? 'verb' : 'noun' }));
  let compared = [];
  const result = await groupEntrySensesLocally({ word, senses }, {
   storage: null,
   encodeDefinitionTexts: async texts => { compared = texts; return null; }
  });
  // “To” and “etc.” are covered by the ordinary wording rule for “jug”.
  assert.equal(compared.length, word === 'jug' ? 0 : 2, word);
  assert.equal(result.senses.length, word === 'jug' ? 1 : 2, word);
  assert.deepEqual(result.senses.flatMap(sense => sense.groupedSenses), senses);
 }
});
test('wording rules preserve different materials, restrictions and numerical quantities', () => {
 const sense = definition => ({ word: 'probe', partOfSpeech: 'noun', definition });
 for (const [a,b] of [
  ['The wood of an elm tree.', 'The wood of a beech tree.'],
  ['The wood of a spruce.', 'Only the wood of a spruce used for furniture.'],
  ['As much as a cup will hold.', 'Twice as much as a cup will hold.'],
  ['A drinking glass with a base and stem.', 'A drinking glass without a base and stem.'],
  ['A drinking vessel with a foot and stem.', 'A glass stem with a foot and drinking vessel.']
 ]) assert.equal(areSensesNearDuplicate(sense(a),sense(b)),false,`${a} / ${b}`);
});

test('yield folds domain applications into core learner meanings without a model, and preserves all 24 sources', async () => {
 const { readFile } = await import('node:fs/promises');
 const { consolidateEntrySenses } = await import('../js/services/localSenseGrouping.js');
 const entry = JSON.parse(await readFile(new URL('./fixtures/learner-meaning-consolidation/yield.json', import.meta.url)));
 const result = await consolidateEntrySenses(entry, { storage: null, encodeDefinitionTexts: async () => assert.fail('These core groups require no model') });
 assert.equal(result.senses.length, 15);
 assert.equal(result.senseConsolidation.originalCount, 24);
 const grouped = new Map(result.senses.filter(s => s.meaningGroup.rule).map(s => [s.meaningGroup.rule, s]));
 for (const [key, size] of [['produce-result',4],['give-up-possession',2],['quantity-output',5],['investment-return',2]]) {
  assert.equal(grouped.get(key).groupedSenses.length,size,key);
  assert.ok(grouped.get(key).usageNote.length > 0);
  assert.ok(grouped.get(key).usageNote.length < 220, 'Domain details should not repeat every source definition');
 }
 assert.deepEqual(new Set(result.senses.flatMap(s=>s.groupedSenses.map(s=>s.id))),new Set(entry.senses.map(s=>s.id)));
 for (const id of [7,8,9,10,18,21,22]) assert.ok(result.senses.some(s=>s.groupedSenses.length===1&&s.groupedSenses[0].id===`dictionary-raw-${id}`));
});
test('core application rules retain polarity, restrictions, historical use and distinct parts of speech', async () => {
 const entry={word:'probe',senses:[
  {id:'a',partOfSpeech:'verb',definition:'To generate an output as a result.'},
  {id:'b',partOfSpeech:'verb',definition:'To produce as a result.'},
  {id:'c',partOfSpeech:'verb',definition:'To produce no output as a result.'},
  {id:'d',partOfSpeech:'verb',definition:'To produce only one result.'},
  {id:'e',partOfSpeech:'verb',definition:'(obsolete) To produce as a result.'},
  {id:'f',partOfSpeech:'noun',definition:'A result produced.'}
 ]};
 const result=await groupEntrySensesLocally(entry,{storage:null,encodeDefinitionTexts:async()=>null});
 assert.equal(result.senses.length,5);
 assert.deepEqual(result.senses.find(s=>s.groupedSenses.length===2).groupedSenses.map(s=>s.id),['a','b']);
});
