import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateUseItFallback, evaluateUseItSentence } from '../js/services/useItEvaluation.js';
import { replaceTargetWordForm, sentenceUsesTargetForm, targetWordForms } from '../js/utils/wordForms.js';

test('Use It accepts regular plural nouns instead of demanding the dictionary headword', () => {
  const pest = { word: 'pest', partOfSpeech: 'noun', definition: 'A destructive insect or animal.' };
  const result = evaluateUseItFallback(pest, 'Pests destroyed the entire crop.');
  assert.equal(result.used, true);
  assert.equal(result.correct, true);
  assert.doesNotMatch(result.feedback, /Include.*pest/i);
});

test('Use It accepts concise valid sentences instead of enforcing an arbitrary four-word minimum', () => {
  const lush = { word: 'lush', partOfSpeech: 'noun', definition: 'A person who drinks too much alcohol.' };
  assert.equal(evaluateUseItFallback(lush, "He's a lush.").correct, true);

  const cuddle = { word: 'cuddle', partOfSpeech: 'verb', definition: 'Hold someone close affectionately.' };
  assert.equal(evaluateUseItFallback(cuddle, 'I like cuddling.').correct, true);
});

test('word-form matching supports tense, participles, spelling changes, and common irregular forms', () => {
  assert.equal(sentenceUsesTargetForm('She walked home after work.', { word: 'walk', partOfSpeech: 'verb' }), true);
  assert.equal(sentenceUsesTargetForm('They are walking home now.', { word: 'walk', partOfSpeech: 'verb' }), true);
  assert.equal(sentenceUsesTargetForm('He studies every evening.', { word: 'study', partOfSpeech: 'verb' }), true);
  assert.equal(sentenceUsesTargetForm('She ran before breakfast.', { word: 'run', partOfSpeech: 'verb' }), true);
  assert.equal(sentenceUsesTargetForm('The children played outside.', { word: 'child', partOfSpeech: 'noun' }), true);
  assert.equal(sentenceUsesTargetForm('Pesticide use increased.', { word: 'pest', partOfSpeech: 'noun' }), false);
  assert.ok(targetWordForms({ word: 'run', partOfSpeech: 'verb' }).includes('ran'));
});

test('daily context replacement removes the inflected form, not only the headword', () => {
  assert.equal(
    replaceTargetWordForm('Several pests attacked the crops.', { word: 'pest', partOfSpeech: 'noun' }),
    'Several ________ attacked the crops.'
  );
});

test('Gemini Use It evaluation is explicitly told to accept grammatical inflections', async () => {
  const values = new Map([['keepvocab_gemini_live_key_v1', 'AIza-test-key-for-use-it-forms-123456789']]);
  const storage = { getItem: key => values.get(key) || null };
  let prompt = '';
  const result = await evaluateUseItSentence(
    { word: 'walk', partOfSpeech: 'verb', definition: 'Move on foot.' },
    'She walked home after work.',
    {
      storage,
      fetchImpl: async (_url, options) => {
        prompt = JSON.parse(options.body).contents[0].parts[0].text;
        return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: '{"used":true,"senseCorrect":true,"grammatical":true,"natural":true,"correct":true,"feedback":"Good sentence.","improvedSentence":""}' }] } }] }; } };
      }
    }
  );

  assert.equal(result.correct, true);
  assert.match(prompt, /past-tense, participle, gerund/);
  assert.match(prompt, /never require the exact headword spelling/);
  assert.match(prompt, /walked/);
});

test('a model cannot misreport a recognized inflection as a missing target word', async () => {
  const values = new Map([['keepvocab_gemini_live_key_v1', 'AIza-test-key-for-use-it-guard-123456789']]);
  const storage = { getItem: key => values.get(key) || null };
  const result = await evaluateUseItSentence(
    { word: 'pest', partOfSpeech: 'noun', definition: 'A destructive insect or animal.' },
    'Pests destroyed the entire crop.',
    {
      storage,
      fetchImpl: async () => ({ ok: true, async json() { return { candidates: [{ content: { parts: [{ text: '{"used":false,"senseCorrect":true,"grammatical":true,"natural":true,"correct":false,"feedback":"Include pest in the sentence.","improvedSentence":""}' }] } }] }; } })
    }
  );

  assert.equal(result.used, true);
  assert.equal(result.correct, true);
  assert.doesNotMatch(result.feedback, /include pest/i);
});

test('Gemini evaluates a related part-of-speech form instead of being blocked by a local word gate', async () => {
  const values = new Map([['keepvocab_gemini_live_key_v1', 'AIza-test-key-for-use-it-cross-pos-123456789']]);
  const storage = { getItem: key => values.get(key) || null };
  let called = false;
  const result = await evaluateUseItSentence(
    { word: 'cuddle', partOfSpeech: 'noun', definition: 'An affectionate embrace.' },
    'She cuddled the sleepy child.',
    {
      storage,
      fetchImpl: async () => {
        called = true;
        return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: '{"used":true,"senseCorrect":true,"grammatical":true,"natural":true,"correct":true,"feedback":"The sentence uses the affectionate meaning naturally.","improvedSentence":""}' }] } }] }; } };
      }
    }
  );

  assert.equal(called, true);
  assert.equal(result.correct, true);
  assert.ok(targetWordForms({ word: 'cuddle', partOfSpeech: 'noun' }).includes('cuddled'));
});

test('offline Use It saves any non-empty sentence without an exact-word error', async () => {
  const storage = { getItem: () => null };
  const result = await evaluateUseItSentence(
    { word: 'cuddle', partOfSpeech: 'noun', definition: 'An affectionate embrace.' },
    'She hugged the sleepy child.',
    { storage }
  );

  assert.equal(result.correct, true);
  assert.equal(result.evaluatedBy, 'local-save');
  assert.doesNotMatch(result.feedback, /use .+word|include|exact|form/i);
});

test('manual and Weak Words Use It modes share the same exercise component and evaluator', async () => {
  const manualSource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../js/components/UseItMode.js', import.meta.url), 'utf8'));
  const sessionSource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../js/components/DailySessionMode.js', import.meta.url), 'utf8'));

  assert.match(manualSource, /mountUseItExercise/);
  assert.match(sessionSource, /mountUseItExercise/);
  assert.match(sessionSource, /evaluateUseItSentence/);
  assert.match(sessionSource, /daily-session-shell/);
  assert.match(sessionSource, /Today's Workout/);
});
