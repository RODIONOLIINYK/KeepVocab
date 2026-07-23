import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWordChoices, stableWordChoices } from '../js/components/PracticeModes.js';

test('Choose Word includes the target and only unique alternative spellings', () => {
  const target = { id: '1', word: 'bank', definition: 'A financial institution.' };
  const choices = buildWordChoices(target, [
    target,
    { id: '2', word: 'bank', definition: 'Land beside a river.' },
    { id: '3', word: 'river' },
    { id: '4', word: 'money' },
    { id: '5', word: 'branch' },
    { id: '6', word: 'loan' }
  ]);

  assert.ok(choices.some(choice => choice.id === target.id));
  assert.equal(choices.length, 4);
  assert.equal(new Set(choices.map(choice => choice.word.toLowerCase())).size, choices.length);
});

test('Choose Word keeps the exact option order while feedback is rendered', () => {
  const words = [
    { id: '1', word: 'bank', definition: 'A financial institution.' },
    { id: '2', word: 'river' },
    { id: '3', word: 'money' },
    { id: '4', word: 'branch' }
  ];
  const state = { targetId: null, options: [] };
  const before = stableWordChoices(state, words[0], words);
  const after = stableWordChoices(state, words[0], [...words].reverse());

  assert.strictEqual(after, before);
  assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
});

test('Choose Word never displays two identical distractor spellings', () => {
  const target = { id: '1', word: 'ephemeral' };
  const choices = buildWordChoices(target, [
    target,
    { id: '2', word: 'bank', definition: 'Financial institution.' },
    { id: '3', word: 'bank', definition: 'River edge.' },
    { id: '4', word: 'serendipity' }
  ]);

  assert.equal(new Set(choices.map(choice => choice.word.toLowerCase())).size, choices.length);
});
