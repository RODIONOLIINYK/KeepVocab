import test from 'node:test';
import assert from 'node:assert/strict';

import { assignExamplesToSenses, hasExampleSenseConflict, sanitizeExistingExamples } from '../js/services/exampleSearch.js';

test('automatic examples are assigned to separate meanings with source metadata', () => {
  const senses = [
    { definition: 'A financial institution that holds money.', synonyms: ['lender'] },
    { definition: 'The land beside a river.', synonyms: ['shore'] }
  ];
  const result = assignExamplesToSenses('bank', senses, [
    { id: 11, text: 'She deposited her money at the bank.', owner: 'Alice', license: 'CC BY 2.0' },
    { id: 12, text: 'We rested on the river bank.', owner: 'Bob', license: 'CC BY 2.0' }
  ]);

  assert.match(result[0].example, /money/i);
  assert.match(result[1].example, /river/i);
  assert.equal(result[0].exampleSourceUrl, 'https://tatoeba.org/en/sentences/show/11');
  assert.match(result[0].exampleAttribution, /Tatoeba/);
});

test('automatic examples reject profane or overly short sentences', () => {
  const [result] = assignExamplesToSenses('idiot', [{ definition: 'A foolish person.' }], [
    { id: 1, text: 'Idiot!' },
    { id: 2, text: 'That fucking idiot ruined it.' },
    { id: 3, text: 'Calling another person an idiot rarely helps.' }
  ]);

  assert.equal(result.example, 'Calling another person an idiot rarely helps.');
});

test('a musical augment sense rejects an augmented-reality example', () => {
  const sense = {
    definition: 'To slow the tempo or meter, e.g. for a dramatic or stately passage.',
    example: 'Augmented reality enables the user to interact with the real world superimposed by virtual objects.',
    exampleSourceUrl: 'https://example.test/bad'
  };

  assert.equal(hasExampleSenseConflict('augment', sense), true);
  const [cleaned] = sanitizeExistingExamples('augment', [sense]);
  assert.match(cleaned.example, /composer.*theme.*slower.*passage/i);
  assert.equal(cleaned.exampleAttribution, 'KeepVocab sense-checked example');
  assert.equal(cleaned.exampleSourceUrl, '');
});

test('multi-sense assignment leaves a meaning blank instead of attaching an unrelated example', () => {
  const result = assignExamplesToSenses('augment', [
    { definition: 'To increase or make larger.' },
    { definition: 'To slow the tempo or meter in a musical passage.' }
  ], [
    { id: 1, text: 'Augmented reality overlays virtual objects on the real world.' }
  ]);

  assert.deepEqual(result.map(sense => sense.example || ''), ['', '']);
});

test('startup repair preserves user-written examples unless a known sense contradiction is present', () => {
  const sense = {
    definition: 'To increase or make larger.',
    example: 'This extra evidence made our understanding much stronger.'
  };

  assert.equal(hasExampleSenseConflict('augment', sense), false);
  assert.equal(sanitizeExistingExamples('augment', [sense])[0].example, sense.example);
});
