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
  assert.match(prompt, /Preferred meaning-hint language: English/);
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

test('English Context uses Ukrainian meanings and hides punctuated phrase targets', async () => {
  const phraseWords = [
    { id: 'phrase-1', word: 'Hello!', definition: 'A friendly greeting.', translation: 'Привіт!', translationLanguage: 'uk' },
    { id: 'phrase-2', word: 'Thanks.', definition: 'An expression of gratitude.', translation: 'Дякую.', translationLanguage: 'uk' },
    { id: 'phrase-3', word: 'Please.', definition: 'A polite request.', translation: 'Будь ласка.', translationLanguage: 'uk' }
  ];
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_settings', JSON.stringify({ translationLanguage: 'uk' }));
  const prompt = buildContextExercisePrompt(phraseWords, { storage });
  assert.match(prompt, /Create English context-cloze questions/);
  assert.match(prompt, /Preferred meaning-hint language: Ukrainian/);
  assert.match(prompt, /Привіт!/);
  const generated = await generateContextExerciseSet(phraseWords, {
    storage,
    generate: async () => ({ items: [
      { wordId: 'phrase-1', sentence: 'She said, "Hello!" with a welcoming smile.' },
      { wordId: 'phrase-2', sentence: 'He said, "Thanks." before leaving the station.' },
      { wordId: 'phrase-3', sentence: 'Please, take a seat near the window.' }
    ] })
  });
  assert.equal(generated.items.length, 3);
  assert.equal(clozeContextSentence(generated.items[0].sentence, 'Hello!'), 'She said, "_____!" with a welcoming smile.');
  assert.equal(clozeContextSentence(generated.items[1].sentence, 'Thanks.'), 'He said, "_____." before leaving the station.');
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

test('historical quotations cannot return through saved or generated Context sentences', async () => {
  const historical = 'I believe, Lady, your Ladyſhip obſerved the malleable material which vvas dreſt in outlandiſh Garments.';
  const selected = words.map((word, index) => ({ ...word, example: index ? [
    '', 'The meager meal left the hikers hungry.', 'She faced her adversary in the final match.'
  ][index] : historical }));
  assert.throws(() => buildLocalContextSet(selected), /at least 3/);
  let calls = 0;
  const result = await generateContextExerciseSet(selected, { storage: new MemoryStorage(), generate: async () => {
    calls += 1;
    return { items: calls === 1 ? [
      { wordId: 'w-1', sentence: historical },
      { wordId: 'w-2', sentence: selected[1].example },
      { wordId: 'w-3', sentence: selected[2].example }
    ] : [{ wordId: 'w-1', sentence: 'The warm clay stayed malleable in her hands.' }] };
  } });
  assert.equal(calls, 2);
  assert.equal(result.items.find(item => item.wordId === 'w-1').sentence, 'The warm clay stayed malleable in her hands.');
  assert.ok(result.items.every(item => !item.sentence.includes('ſ')));
});


test('changing a Ukrainian selected meaning invalidates the Context cache', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const generate = async () => {
    calls += 1;
    return { items: [
      { wordId: 'w-1', sentence: 'The warm clay remained malleable.' },
      { wordId: 'w-2', sentence: 'The meager portion left everyone hungry.' },
      { wordId: 'w-3', sentence: 'She studied her adversary.' }
    ] };
  };
  await generateContextExerciseSet(words, { storage, generate });
  await generateContextExerciseSet(words.map(word => ({ ...word, translation: 'Змінене значення' })), { storage, generate });
  assert.equal(calls, 2);
});

test('a full browser cache does not discard a successfully generated Context set', async () => {
  const generated = await generateContextExerciseSet(words, {
    storage: { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } },
    generate: async () => ({ items: [
      { wordId: 'w-1', sentence: 'The warm clay remained malleable.' },
      { wordId: 'w-2', sentence: 'The meager portion left everyone hungry.' },
      { wordId: 'w-3', sentence: 'She studied her adversary.' }
    ] })
  });
  assert.equal(generated.items.length, 3);
});

test('cached offline Context sets retain their source and valid partial coverage', async () => {
  const storage = new MemoryStorage();
  const selected = [
    ...words.map((word, index) => ({ ...word, example: [
      'The warm clay remained malleable.',
      'The meager portion left everyone hungry.',
      'She studied her adversary.'
    ][index] })),
    { id: 'w-4', word: 'vivid', definition: 'Bright and distinct.' }
  ];
  let calls = 0;
  const generate = async () => { calls += 1; return { items: [] }; };
  const first = await generateContextExerciseSet(selected, { storage, generate });
  const second = await generateContextExerciseSet(selected, { storage, generate });
  assert.equal(calls, 2); // First request and its missing-item repair only.
  assert.equal(first.kind, 'local');
  assert.equal(second.kind, 'local');
  assert.ok(second.items.every(item => item.source === 'saved-example'));
  assert.deepEqual(second.skippedWordIds, ['w-4']);
});


test('switching the translation setting creates Context questions from the selected hint language', async () => {
  const storage = new MemoryStorage();
  const translatedWords = words.map(word => ({ ...word, translation: 'Українське значення', translationLanguage: 'uk' }));
  const prompts = [];
  const generate = async prompt => {
    prompts.push(prompt);
    return { items: [
      { wordId: 'w-1', sentence: 'The warm clay remained malleable.' },
      { wordId: 'w-2', sentence: 'The meager portion left everyone hungry.' },
      { wordId: 'w-3', sentence: 'She studied her adversary.' }
    ] };
  };
  await generateContextExerciseSet(translatedWords, { storage, generate });
  storage.setItem('keepvocab_settings', JSON.stringify({ translationLanguage: 'uk' }));
  await generateContextExerciseSet(translatedWords, { storage, generate });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Preferred meaning-hint language: English/);
  assert.doesNotMatch(prompts[0], /Українське значення/);
  assert.match(prompts[1], /Preferred meaning-hint language: Ukrainian/);
  assert.match(prompts[1], /Українське значення/);
});
