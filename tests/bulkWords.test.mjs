import test from 'node:test';
import assert from 'node:assert/strict';
import { attachImagesSequentially, BULK_LOOKUP_DELAY_MS, bulkResultToWord, dedupeBulkResults, lookupBulkWords, MAX_BULK_WORDS, parseBulkWordList, retryMissingBulkWords } from '../js/services/bulkWords.js';

test('bulk word lists accept lines, commas, semicolons, bullets, and remove duplicate spellings', () => {
  assert.deepEqual(
    parseBulkWordList('resilient\n• meticulous, take into account; Resilient\n2. pragmatic'),
    ['resilient', 'meticulous', 'take into account', 'pragmatic']
  );
  assert.equal(MAX_BULK_WORDS, 100);
  assert.equal(BULK_LOOKUP_DELAY_MS, 1000);
  assert.equal(parseBulkWordList(Array.from({ length: 125 }, (_, index) => `word${index}`).join('\n')).length, 100);
});

test('a 100-word lookup is strictly sequential and preserves list order', async () => {
  const terms = Array.from({ length: 100 }, (_, index) => `word${index + 1}`);
  const started = [];
  let active = 0;
  let maximumActive = 0;
  const progress = [];
  const results = await lookupBulkWords(terms, async term => {
    started.push(term);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    return { word: term, senses: [{ partOfSpeech: 'noun', definition: `${term} definition` }] };
  }, { delayMs: 0, onProgress: event => progress.push(event.completed) });

  assert.equal(results.length, 100);
  assert.equal(maximumActive, 1);
  assert.deepEqual(started, terms);
  assert.deepEqual(results.map(result => result.term), terms);
  assert.equal(progress.at(-1), 100);
});

test('bulk lookup keeps failed words available for manual definitions', async () => {
  const results = await lookupBulkWords(['first', 'second', 'third'], async term => {
    if (term === 'second') throw new Error('Not found');
    return { word: term, senses: [{ partOfSpeech: 'noun', definition: `${term} definition` }] };
  });
  assert.deepEqual(results.map(result => [result.term, result.status]), [
    ['first', 'ready'], ['second', 'manual'], ['third', 'ready']
  ]);
  assert.equal(bulkResultToWord(results[0]).definition, 'first definition');
  assert.equal(bulkResultToWord(results[1], 0, 'A manual meaning.').definition, 'A manual meaning.');
});

test('bulk lookup retries only transient failures without overlapping requests', async () => {
  let calls = 0;
  const lookup = async term => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Temporarily unavailable');
      error.code = 'NETWORK';
      throw error;
    }
    return { word: term, senses: [{ definition: 'Recovered.' }] };
  };
  const [result] = await lookupBulkWords(['recover'], lookup, { retries: 1, retryDelayMs: 0 });
  assert.equal(calls, 2);
  assert.equal(result.status, 'ready');
});

test('retry missing meanings processes only failed rows and preserves manual text', async () => {
  const original = [
    { term: 'ready', status: 'ready', data: { word: 'ready', definition: 'Already present.' } },
    { term: 'recover', status: 'manual', error: 'Temporary failure' },
    { term: 'still-missing', status: 'manual', error: 'Not found', manualDefinition: 'My draft.' }
  ];
  const calls = [];
  const retried = await retryMissingBulkWords(original, async term => {
    calls.push(term);
    if (term === 'still-missing') throw new Error('Not found again');
    return { word: term, senses: [{ definition: 'Recovered meaning.' }] };
  }, { delayMs: 0 });

  assert.deepEqual(calls, ['recover', 'still-missing']);
  assert.equal(retried[0], original[0]);
  assert.equal(retried[1].status, 'ready');
  assert.equal(retried[2].status, 'manual');
  assert.equal(retried[2].manualDefinition, 'My draft.');
});

test('corrected spellings that resolve to the same word are merged', () => {
  const results = dedupeBulkResults([
    { term: 'recieve', status: 'ready', data: { word: 'receive', correctedFrom: 'recieve' } },
    { term: 'receive', status: 'ready', data: { word: 'receive' } },
    { term: 'accept', status: 'ready', data: { word: 'accept' } }
  ]);
  assert.deepEqual(results.map(result => result.data.word), ['receive', 'accept']);
});

test('automatic images are selected sequentially and saved with attribution', async () => {
  const words = Array.from({ length: 12 }, (_, index) => ({ word: `term${index}`, definition: `Meaning ${index}` }));
  let active = 0;
  let maximumActive = 0;
  const seenExclusions = [];
  const enriched = await attachImagesSequentially(words, async (word, options) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    seenExclusions.push([...options.excludeUrls]);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    return [{
      url: `https://images.example/${word.word}.jpg`,
      sourceUrl: `https://source.example/${word.word}`,
      attribution: `Photographer for ${word.word}`,
      license: 'Example License',
      searchQuery: `${word.word} meaning`
    }];
  });

  assert.equal(maximumActive, 1);
  assert.equal(enriched.length, words.length);
  assert.equal(enriched[0].imageAttribution, 'Photographer for term0');
  assert.equal(enriched[11].imageSearchQuery, 'term11 meaning');
  assert.ok(seenExclusions[1].includes('https://images.example/term0.jpg'));
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
