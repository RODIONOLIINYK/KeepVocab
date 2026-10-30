import test from 'node:test';
import assert from 'node:assert/strict';
import { attachImagesSequentially, BULK_LOOKUP_DELAY_MS, bulkResultToWord, dedupeBulkResults, lookupBulkWords, MAX_BULK_WORDS, parseBulkWordList, retryMissingBulkWords } from '../js/services/bulkWords.js';

test('bulk word lists accept lines, commas, semicolons, bullets, and remove duplicate spellings', () => {
  assert.deepEqual(
    parseBulkWordList('resilient\n• meticulous, take into account; Resilient\n2. pragmatic'),
    ['resilient', 'meticulous', 'take into account', 'pragmatic']
  );
  assert.equal(MAX_BULK_WORDS, 100);
  assert.equal(BULK_LOOKUP_DELAY_MS, 150);
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
    { term: 'still-missing', status: 'manual', error: 'Not found', manualDefinition: 'My draft.', manualTranslation: 'Моя чернетка.' }
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
  assert.equal(retried[2].manualTranslation, 'Моя чернетка.');
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
    assert.equal(options.limit, 30);
    assert.equal(options.aiScenes, false);
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
  assert.equal(enriched[0].imageCandidates[0].url, enriched[0].imageUrl);
  assert.equal(enriched[11].imageSearchQuery, 'term11 meaning');
  assert.ok(seenExclusions[1].includes('https://images.example/term0.jpg'));
});

test('each meaning gets a distinct image even if a provider returns an excluded URL or source again', async () => {
  const shared = { url: 'https://images.example/shared.jpg', sourceUrl: 'https://sources.example/shared' };
  const unique = { url: 'https://images.example/second.jpg', sourceUrl: 'https://sources.example/second' };
  const result = await attachImagesSequentially([
    { word: 'bank', definition: 'A financial institution.' },
    { word: 'bank', definition: 'Land beside a river.' }
  ], async word => word.definition.includes('financial') ? [shared] : [shared, { ...shared, url: 'https://images.example/shared-resized.jpg' }, unique]);
  assert.equal(result[0].imageUrl, shared.url);
  assert.equal(result[1].imageUrl, unique.url);
  assert.deepEqual(result[1].imageCandidates, [unique]);
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
        { partOfSpeech: 'noun', definition: 'Land beside a river.', translation: 'Берег річки.', example: 'They sat on the bank.' }
      ]
    }
  };
  const word = bulkResultToWord(result, 1);
  assert.equal(word.definition, 'Land beside a river.');
  assert.equal(word.audioUrl, 'https://audio.example/bank.mp3');
  assert.equal(word.example, 'They sat on the bank.');
  assert.equal(word.translation, 'Берег річки.');
  assert.equal(word.translationLanguage, 'uk');
});

test('manual bulk rows preserve a Ukrainian translation instead of copying the English definition', () => {
  const word = bulkResultToWord({ term: 'bank', status: 'manual', manualTranslation: 'Берег річки.' }, 0, 'Land beside a river.');
  assert.equal(word.definition, 'Land beside a river.');
  assert.equal(word.translation, 'Берег річки.');
  assert.equal(word.translationLanguage, 'uk');
  const untranslated = bulkResultToWord({ term: 'bank', status: 'manual' }, 0, 'Land beside a river.');
  assert.equal(untranslated.translation, 'Land beside a river.');
  assert.equal(untranslated.translationLanguage, 'en');
});

test('skipping an in-flight bulk image search returns every original word immediately and ignores late provider results', async () => {
  for (const lateFailure of [false, true]) {
    const words = ['first', 'second', 'third'].map(word => ({ word, definition: `The meaning of ${word}.` }));
    const before = structuredClone(words);
    const controller = new AbortController();
    const progress = [];
    const searched = [];
    let finishLate;
    let failLate;
    let activeSignal;
    let reachedSecond;
    const secondStarted = new Promise(resolve => { reachedSecond = resolve; });
    const prepared = attachImagesSequentially(words, async (word, options) => {
      searched.push(word.word);
      activeSignal = options.signal;
      if (word.word === 'first') return [{ url: 'https://example.test/first.jpg' }];
      reachedSecond();
      return new Promise((resolve, reject) => { finishLate = resolve; failLate = reject; });
    }, { skipImagesSignal: controller.signal, onProgress: item => progress.push(item) });
    await secondStarted;
    controller.abort();
    const saved = await prepared;
    assert.deepEqual(saved, before, 'Skip discards even the first completed proposal');
    assert.equal(activeSignal.aborted, true);
    assert.deepEqual(searched, ['first', 'second']);
    assert.equal(progress.length, 1);
    if (lateFailure) failLate(new Error('Late network failure'));
    else finishLate([{ url: 'https://example.test/too-late.jpg' }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(saved, before);
    assert.deepEqual(words, before);
    assert.equal(progress.length, 1);
    assert.deepEqual(searched, ['first', 'second'], 'Skip never starts the third word');
  }
});

test('skipping before imagery starts avoids all searches and drops stale candidate lists', async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await attachImagesSequentially([{ word: 'kept', definition: 'A saved meaning.', imageUrl: 'https://example.test/original.jpg', imageCandidates: [{ url: 'https://example.test/proposal.jpg' }] }],
    async () => assert.fail('Skipped images must not start any provider'), { skipImagesSignal: controller.signal });
  assert.equal(result[0].imageUrl, 'https://example.test/original.jpg');
  assert.equal(result[0].imageCandidates, undefined);
});
