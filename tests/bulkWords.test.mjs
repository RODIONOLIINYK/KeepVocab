import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkWordList, lookupBulkWords, bulkResultToWord, MAX_BULK_WORDS } from '../js/services/bulkWords.js';

test('bulk word lists accept lines, commas, semicolons, bullets, and remove duplicate spellings', () => {
  assert.deepEqual(
    parseBulkWordList('resilient\n• meticulous, take into account; Resilient\n2. pragmatic'),
    ['resilient', 'meticulous', 'take into account', 'pragmatic']
  );
  assert.equal(parseBulkWordList(Array.from({ length: 40 }, (_, index) => `word${index}`).join('\n')).length, MAX_BULK_WORDS);
});

test('bulk lookup preserves list order and keeps failed words available for manual definitions', async () => {
  const results = await lookupBulkWords(['first', 'second', 'third'], async term => {
    if (term === 'second') throw new Error('Not found');
    return { word: term, senses: [{ partOfSpeech: 'noun', definition: `${term} definition` }] };
  }, 2);
  assert.deepEqual(results.map(result => [result.term, result.status]), [
    ['first', 'ready'], ['second', 'manual'], ['third', 'ready']
  ]);
  assert.equal(bulkResultToWord(results[0]).definition, 'first definition');
  assert.equal(bulkResultToWord(results[1], 0, 'A manual meaning.').definition, 'A manual meaning.');
});

test('bulk sense conversion saves the explicitly selected meaning and pronunciation audio', () => {
  const result = {
    term: 'bank',
    status: 'ready',
    data: {
      word: 'bank',
      phonetic: '/bæŋk/',
      audioUrl: 'https://audio.example/bank.mp3',
      senses: [
        { partOfSpeech: 'noun', definition: 'A financial institution.' },
        { partOfSpeech: 'noun', definition: 'Land beside a river.', example: 'They sat on the bank.' }
      ]
    }
  };
  const word = bulkResultToWord(result, 1);
  assert.equal(word.definition, 'Land beside a river.');
  assert.equal(word.audioUrl, 'https://audio.example/bank.mp3');
  assert.equal(word.example, 'They sat on the bank.');
});
