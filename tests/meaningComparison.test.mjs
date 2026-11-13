import test from 'node:test';
import assert from 'node:assert/strict';
import { meaningComparisonText, meaningEmbeddingText, meaningWords, countMatchingMeaningWords } from '../js/services/meaningComparison.js';
import { areSensesNearDuplicate } from '../js/services/learningDefinitions.js';
import { groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
import { embedMeaningAnchors, pairEvidence } from '../js/services/meaningEquivalenceLearning.js';
import { CLIP_DIMENSION } from '../js/ml/clipConfig.js';

const sense = (word, definition, fields = {}) => ({word, definition, partOfSpeech:'verb', ...fields});
test('comparison removes editorial annotations while preserving semantic qualifiers and unmatched text', () => {
 assert.equal(meaningComparisonText('(transitive or intransitive, especially US) To give way.'),'To give way.');
 assert.equal(meaningComparisonText('(US [informal]) To carry (something) from one place [chiefly UK] to another.'),'To carry (something) from one place to another.');
 assert.equal(meaningComparisonText('(computing, intransitive) To execute a program.'),'(computing) To execute a program.');
 assert.equal(meaningComparisonText('To flow (intransitive, of liquids) smoothly.'),'To flow (of liquids) smoothly.');
 assert.equal(meaningComparisonText('(mathematics) A set with an operation.'),'(mathematics) A set with an operation.');
 assert.equal(meaningComparisonText('To replenish energy to (a battery, or a device containing a battery).'),'To replenish energy to (a battery, or a device containing a battery).');
 assert.equal(meaningComparisonText('A label (unclosed and the remaining meaning.'),'A label (unclosed and the remaining meaning.');
 assert.equal(meaningComparisonText('(chiefly US, informal)'),'');
 assert.equal(meaningComparisonText('(usage only)'),'(usage only)');
});
test('editorial annotations cannot block otherwise identical glosses while semantic qualifiers are preserved', async () => {
 for(const [word,plain,annotated,labels] of [
  ['carry','To transport from one place to another.','(transitive or intransitive, especially US) To transport from one place to another.',['US','especially','transitive','intransitive']],
  ['bright','Having a vivid colour.','[UK, informal] Having [chiefly US] a vivid colour.',['UK','informal']],
  ['goblet','A drinking vessel with a foot and stem.','(countable, especially US) A drinking vessel with a foot and stem.',['countable','US']],
  ['flow','To move continuously in a stream.','To move (intransitive) continuously in a stream.',['intransitive']]
 ]){
  const partOfSpeech=word==='bright'?'adjective':word==='goblet'?'noun':'verb';
  const senses=[sense(word,plain,{id:'a',partOfSpeech}),sense(word,annotated,{id:'b',labels,partOfSpeech})];
  const before=structuredClone(senses);
  const result=await groupEntrySensesLocally({word,senses},{storage:null,encodeDefinitionTexts:async()=>assert.fail('No model needed for matching cleaned glosses')});
  assert.equal(result.senses.length,1,word);assert.deepEqual(result.senses[0].groupedSenses,before);assert.deepEqual(senses,before);
 }
 assert.notEqual(
  meaningComparisonText('To move (intransitive, of liquids) continuously in a stream.'),
  meaningComparisonText('To move continuously in a stream.')
 );
 assert.notEqual(
  meaningComparisonText('(mathematics) A collection of elements.'),
  meaningComparisonText('(computing) A collection of elements.')
 );
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

test('all definition embedding anchors exclude editorial annotations and retain semantic qualifiers with versioned pair provenance',async()=>{
 const senses=[sense('probe','(transitive or intransitive, especially US) To produce a result (mathematics).'),sense('probe','To produce [UK] a result (mathematics).')];
 let texts;const vector=Array.from({length:CLIP_DIMENSION},(_,i)=>Number(i===0));
 const anchors=await embedMeaningAnchors('probe',senses,{encodeDefinitionTexts:async input=>{texts=input;return input.map(()=>vector);}});
 assert.equal(texts.length,6);assert.ok(texts.every(t=>!/(transitive|intransitive|especially|US|UK|\[)/.test(t)));
 assert.equal(texts[0],'To produce a result (mathematics).');assert.equal(texts[2],'probe (verb): To produce a result (mathematics).');
 const evidence=pairEvidence(senses[0],senses[1],anchors[0],anchors[1]);
 assert.equal(evidence.definitionA,senses[0].definition);assert.equal(evidence.definitionB,senses[1].definition);
 assert.equal(evidence.comparisonVersion,'semantic-qualifiers-v2');
});
