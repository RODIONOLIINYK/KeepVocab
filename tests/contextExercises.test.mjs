import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildContextExercisePrompt, buildLocalContextSet, clozeContextSentence, generateContextExerciseSet } from '../js/services/contextExercises.js';
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

test('Lithuanian Context requests Lithuanian-only sentences and hides punctuated phrase targets', async () => {
  const lithuanianWords = [
    { id: 'lt-1', courseId: 'lithuanian', word: 'Laba diena!', definition: 'Good afternoon!' },
    { id: 'lt-2', courseId: 'lithuanian', word: 'Ačiū.', definition: 'Thank you.' },
    { id: 'lt-3', courseId: 'lithuanian', word: 'Prašau.', definition: 'Please.' }
  ];
  const prompt = buildContextExercisePrompt(lithuanianWords, { courseId: 'lithuanian' });
  assert.match(prompt, /Create Lithuanian context-cloze questions/);
  assert.match(prompt, /natural Lithuanian only/);
  assert.match(prompt, /Never place the target inside an English sentence/);
  const generated = await generateContextExerciseSet(lithuanianWords, {
    courseId: 'lithuanian',
    storage: new MemoryStorage(),
    generate: async () => ({ items: [
      { wordId: 'lt-1', sentence: 'Laba diena! Ar turite laisvą kambarį?' },
      { wordId: 'lt-2', sentence: 'Ačiū. Jūs man labai padėjote.' },
      { wordId: 'lt-3', sentence: 'Prašau, sėskitės prie lango.' }
    ] })
  });
  assert.equal(generated.items.length, 3);
  assert.equal(clozeContextSentence(generated.items[0].sentence, 'Laba diena!'), '_____! Ar turite laisvą kambarį?');
  assert.equal(clozeContextSentence(generated.items[1].sentence, 'Ačiū.'), '_____. Jūs man labai padėjote.');
});

test('Context UI renders only a generated sentence question, not a story or meaning clue', () => {
  const component = readFileSync(resolve(projectRoot, 'js/components/ContextQuizMode.js'), 'utf8');
  assert.match(component, /AI-generated sentence/);
  assert.doesNotMatch(component, /context-story-card|Meaning:|context-definition-clue|fallbackContextPassage/);
  assert.doesNotMatch(component, /target\.definition/);
});

test('incomplete Gemini sets preserve valid items and repair only missing words', async () => {
  const storage = new MemoryStorage();
  const prompts = [];
  const generated = await generateContextExerciseSet(words, {
    storage,
    generate: async prompt => {
      prompts.push(prompt);
      if (prompts.length === 1) return { items: [
        { wordId: 'w-1', sentence: 'The warm clay remained malleable under her hands.' },
        { wordId: 'w-2', sentence: 'This invalid sentence forgot its target.' }
      ] };
      return { items: [
        { wordId: 'w-2', sentence: 'The meager portion left everyone hungry.' },
        { wordId: 'w-3', sentence: 'She studied her adversary before the match.' }
      ] };
    }
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /repair request/i);
  assert.equal(generated.items.length, 3);
  assert.equal(generated.items.find(item => item.wordId === 'w-1').sentence, 'The warm clay remained malleable under her hands.');
});

test('saved examples provide an offline Context fallback without definition clues', () => {
  const local = buildLocalContextSet(words.map((word, index) => ({ ...word, example: [
    'The metal stayed malleable in the workshop.',
    'A meager meal could not satisfy the hikers.',
    'The knight watched his adversary enter the arena.'
  ][index] })));
  assert.equal(local.kind, 'local');
  assert.equal(local.items.length, 3);
  assert.ok(local.items.every(item => item.source === 'saved-example'));
});
