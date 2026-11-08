import test from 'node:test';
import assert from 'node:assert/strict';
import { meaningComparisonText, meaningEmbeddingText } from '../js/services/meaningComparison.js';
import { areSensesNearDuplicate } from '../js/services/learningDefinitions.js';
import { groupEntrySensesLocally, hasExplicitMeaningConflict } from '../js/services/localSenseGrouping.js';
import { embedMeaningAnchors, pairEvidence } from '../js/services/meaningEquivalenceLearning.js';
import { CLIP_DIMENSION } from '../js/ml/clipConfig.js';

const sense = (word, definition, fields = {}) => ({word, definition, partOfSpeech:'verb', ...fields});
test('comparison removes round/square annotations, including nested and inline annotations, without erasing unmatched text', () => {
 assert.equal(meaningComparisonText('(transitive or intransitive, especially US) To give way.'),'To give way.');
 assert.equal(meaningComparisonText('(US [informal]) To carry (something) from one place [chiefly UK] to another.'),'To carry from one place to another.');
 assert.equal(meaningComparisonText('A label (unclosed and the remaining meaning.'),'A label (unclosed and the remaining meaning.');
 assert.equal(meaningComparisonText('(usage only)'),'');
});
test('annotations and extracted metadata cannot block otherwise identical glosses across different words', async () => {
 for(const [word,plain,annotated,labels] of [
  ['carry','To transport from one place to another.','(transitive or intransitive, especially US) To transport from one place to another.',['US','especially','transitive','intransitive']],
  ['bright','Having a vivid colour.','[UK, informal] Having (especially of a surface) a vivid colour.',['UK','informal']],
  ['goblet','A drinking vessel with a foot and stem.','(countable, especially US) A drinking vessel with a foot and stem.',['countable','US']],
  ['flow','To move continuously in a stream.','To move (intransitive, of liquids) continuously in a stream.',['intransitive']]
 ]){
  const partOfSpeech=word==='bright'?'adjective':word==='goblet'?'noun':'verb';
  const senses=[sense(word,plain,{id:'a',partOfSpeech}),sense(word,annotated,{id:'b',labels,partOfSpeech})];
  const before=structuredClone(senses);
  const result=await groupEntrySensesLocally({word,senses},{storage:null,encodeDefinitionTexts:async()=>assert.fail('No model needed for matching cleaned glosses')});
  assert.equal(result.senses.length,1,word);assert.deepEqual(result.senses[0].groupedSenses,before);assert.deepEqual(senses,before);
 }
});
test('other captured dictionary paraphrases merge while complete source clauses remain available',async()=>{
 for(const [word,a,b] of [
  ['charge','An accusation.','An accusation by a person or organization.'],
  ['run','To flow.','(intransitive) Of a liquid or electric current, to flow.'],
  ['faucet','a regulator for controlling the flow of a liquid from a reservoir','An exposed plumbing fitting; a tap or spigot; a regulator for controlling the flow of a liquid from a reservoir.']
 ]){
  const partOfSpeech=word==='run'?'verb':'noun';
  const senses=[sense(word,a,{id:'a',partOfSpeech}),sense(word,b,{id:'b',partOfSpeech})];
  const result=await groupEntrySensesLocally({word,senses},{storage:null,encodeDefinitionTexts:async()=>null});
  assert.equal(result.senses.length,1,word);assert.deepEqual(result.senses[0].groupedSenses,senses);
  if(word==='faucet')assert.equal(result.senses[0].definition,b,'The shorter contained gloss must not discard the longer source explanation');
 }
});
test('comparison cleanup preserves contradictions, historical distinctions, quantities, role order and POS separation',()=>{
 for(const [a,b] of [
  ['(US) Allowed to enter.','(UK) Not allowed to enter.'],
  ['Allowed to enter.','Allowed to enter (not permitted).'],
  ['(US) A group of 3 people.','(UK) A group of 4 people.'],
  ['To give money to a child.','To give a child to money.'],
  ['To produce a result.','(obsolete) To produce a result.'],
  ['To act.','To act (only for adults).']
 ])assert.equal(areSensesNearDuplicate(sense('probe',a),sense('probe',b)),false,`${a} / ${b}`);
 assert.equal(hasExplicitMeaningConflict(sense('probe','To act (sense 1).'),sense('probe','To act.')),false);
 assert.equal(areSensesNearDuplicate(sense('probe','To act.'),sense('probe','(US) To act.',{partOfSpeech:'noun'})),false);
});

test('negation is normalized in text while explicit opposites still veto a merge', () => {
  assert.equal(meaningEmbeddingText('(adjective) Not real.'), 'fake.');
  assert.equal(meaningEmbeddingText('Not hot.'), 'not hot.');
  assert.equal(hasExplicitMeaningConflict(sense('probe', 'Not allowed to enter.'), sense('probe', 'Forbidden to enter.')), false);
  assert.equal(hasExplicitMeaningConflict(sense('probe', 'Not allowed to enter.'), sense('probe', 'Allowed to enter.')), true);
  assert.equal(hasExplicitMeaningConflict(sense('probe', 'Large in size.'), sense('probe', 'Of size large.')), false);
});
test('all definition embedding anchors exclude annotations while pair provenance retains exact sources',async()=>{
 const senses=[sense('probe','(transitive or intransitive, especially US) To produce a result.'),sense('probe','To produce [UK] a result.')];
 let texts;const vector=Array.from({length:CLIP_DIMENSION},(_,i)=>Number(i===0));
 const anchors=await embedMeaningAnchors('probe',senses,{encodeDefinitionTexts:async input=>{texts=input;return input.map(()=>vector);}});
 assert.equal(texts.length,6);assert.ok(texts.every(t=>!/(transitive|intransitive|especially|US|UK|\[)/.test(t)));
 assert.equal(texts[0],'To produce a result.');assert.equal(texts[2],'probe (verb): To produce a result.');
 const evidence=pairEvidence(senses[0],senses[1],anchors[0],anchors[1]);
 assert.equal(evidence.definitionA,senses[0].definition);assert.equal(evidence.definitionB,senses[1].definition);
 assert.equal(evidence.comparisonVersion,'parenthetical-free-v1');
});
