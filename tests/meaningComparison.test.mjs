import test from 'node:test';
import assert from 'node:assert/strict';
import { meaningComparisonText, meaningEmbeddingText, meaningWords, countMatchingMeaningWords } from '../js/services/meaningComparison.js';
import { areSensesNearDuplicate } from '../js/services/learningDefinitions.js';
import { groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
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
test('word matching preserves order, repetition, negation and quantities', () => {
 const words = meaningWords('A child gives a coin to a parent.');
 assert.equal(countMatchingMeaningWords(words, meaningWords('A parent gives a coin to a child.')), 6);
 assert.equal(countMatchingMeaningWords(meaningWords('had had'), meaningWords('had')), 1);
 assert.deepEqual(meaningWords('Amounts of 1.5 and 15.'), ['amounts', 'of', '1.5', 'and', '15']);
 assert.equal(meaningEmbeddingText('(adjective) Not real.'), 'not real.');
 for (const [a,b] of [
  ['Allowed to enter.', 'Not allowed to enter.'],
  ['A group of 3 people.', 'A group of 4 people.'],
  ['To give money to a child.', 'To give a child to money.']
 ]) assert.equal(areSensesNearDuplicate(sense('probe',a),sense('probe',b)), false);
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
