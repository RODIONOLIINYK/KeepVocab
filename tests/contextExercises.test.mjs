import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContextExercisePrompt, clozeContextSentence, generateContextExerciseSet } from '../js/services/contextExercises.js';
import { MemoryStorage } from '../js/services/driveSync.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const words = [
  { id: 'w-1', word: 'malleable', definition: 'Capable of being shaped.', example: 'LEAKED DICTIONARY EXAMPLE ONE' },
  { id: 'w-2', word: 'meager', definition: 'Lacking in quantity or quality.', example: 'LEAKED DICTIONARY EXAMPLE TWO' },
  { id: 'w-3', word: 'adversary', definition: 'An opponent or enemy.', example: 'LEAKED DICTIONARY EXAMPLE THREE' }
];

test('Context generation uses exact meanings but never dictionary examples or a story', () => {
  const prompt = buildContextExercisePrompt(words);
  assert.match(prompt, /Capable of being shaped/);
  assert.doesNotMatch(prompt, /LEAKED DICTIONARY EXAMPLE/);
  assert.match(prompt, /Do not create a story, passage, dialogue/);
  assert.doesNotMatch(prompt, /"title"|"scene"/);
});

test('Gemini Context results are complete, cached, and clozed without exposing meaning', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const generated = await generateContextExerciseSet(words, {
    storage,
    generate: async () => {
      calls += 1;
      return { items: [
        { wordId: 'w-1', sentence: 'The warm clay remained malleable under her hands.' },
        { wordId: 'w-2', sentence: 'The meager portion left everyone at the table hungry.' },
        { wordId: 'w-3', sentence: 'She studied her adversary before the final match began.' }
      ] };
    }
  });
  assert.equal(generated.items.length, 3);
  assert.equal(clozeContextSentence(generated.items[0].sentence, 'malleable'), 'The warm clay remained _____ under her hands.');
  await generateContextExerciseSet(words, { storage, generate: async () => { calls += 1; } });
  assert.equal(calls, 1);
});

test('Context UI renders only a generated sentence question, not a story or meaning clue', () => {
  const component = readFileSync(resolve(projectRoot, 'js/components/ContextQuizMode.js'), 'utf8');
  assert.match(component, /AI-generated sentence/);
  assert.doesNotMatch(component, /context-story-card|Meaning:|context-definition-clue|fallbackContextPassage/);
  assert.doesNotMatch(component, /target\.definition/);
});
