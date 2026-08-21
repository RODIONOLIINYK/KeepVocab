import test from 'node:test';
import assert from 'node:assert/strict';

import { DictionaryApiError, fetchWordDetails } from '../js/services/dictionaryApi.js';
import { MemoryStorage } from '../js/services/driveSync.js';

test('dictionary lookup returns every distinct sense, audio, examples, and synonyms', async () => {
  const result = await fetchWordDetails(' Ephemeral ', {
    storage: new MemoryStorage(),
    fetchImpl: async (url, options) => {
      assert.match(url, /ephemeral$/);
      assert.equal(options.headers.Accept, 'application/json');
      return {
        ok: true,
        status: 200,
        async json() {
          return [{
            word: 'ephemeral',
            phonetics: [{ text: '/test/', audio: '//audio.example/test.mp3' }],
            meanings: [{
              partOfSpeech: 'adjective',
              synonyms: ['brief'],
              definitions: [
                { definition: 'Lasting a very short time.', example: 'An ephemeral trend.', synonyms: ['fleeting'] },
                { definition: 'Existing for one day only.' }
              ]
            }, {
              partOfSpeech: 'noun',
              definitions: [{ definition: 'Something that lasts briefly.' }]
            }]
          }];
        }
      };
    }
  });

  assert.equal(result.word, 'ephemeral');
  assert.equal(result.phonetic, '/test/');
  assert.equal(result.audioUrl, 'https://audio.example/test.mp3');
  assert.equal(result.definition, 'Lasting a very short time.');
  assert.equal(result.example, 'An ephemeral trend.');
  assert.deepEqual(result.synonyms, ['brief', 'fleeting']);
  assert.equal(result.senses.length, 3);
  assert.deepEqual(result.senses.map(sense => sense.partOfSpeech), ['adjective', 'adjective', 'noun']);
  assert.equal(result.senses[2].definition, 'Something that lasts briefly.');
});

test('404 and invalid inputs are explicit errors, not fabricated entries', async () => {
  await assert.rejects(
    () => fetchWordDetails('<script>', { storage: null, fetchImpl: async () => null }),
    error => error instanceof DictionaryApiError && error.code === 'INVALID_WORD'
  );
  await assert.rejects(
    () => fetchWordDetails('notaword', {
      storage: null,
      fetchImpl: async url => url.includes('api.languagetool.org')
        ? ({ ok: true, status: 200, async json() { return { matches: [] }; } })
        : url.includes('api.datamuse.com')
          ? ({ ok: true, status: 200, async json() { return []; } })
        : ({ ok: false, status: 404 })
    }),
    error => error instanceof DictionaryApiError && error.code === 'NOT_FOUND'
  );
});

test('a close misspelling is corrected only after the original dictionary lookup fails', async () => {
  const calls = [];
  const result = await fetchWordDetails('recieve', {
    storage: new MemoryStorage(),
    fetchImpl: async url => {
      calls.push(url);
      if (url.endsWith('/recieve')) return { ok: false, status: 404 };
      if (url.includes('api.languagetool.org')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { matches: [{ rule: { issueType: 'misspelling' }, replacements: [{ value: 'receive' }, { value: 'relieve' }] }] };
          }
        };
      }
      if (url.endsWith('/receive')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{ word: 'receive', meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To be given something.' }] }] }];
          }
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  });

  assert.equal(result.word, 'receive');
  assert.equal(result.correctedFrom, 'recieve');
  assert.deepEqual(calls.map(url => new URL(url).hostname), ['api.dictionaryapi.dev', 'api.languagetool.org', 'api.dictionaryapi.dev']);
});

test('the dictionary response supplies the canonical spelling even on a successful first request', async () => {
  const result = await fetchWordDetails('recieve', {
    storage: new MemoryStorage(),
    fetchImpl: async url => {
      assert.match(url, /recieve$/);
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ word: 'receive', meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To be given something.' }] }] }];
        }
      };
    }
  });

  assert.equal(result.word, 'receive');
  assert.equal(result.correctedFrom, 'recieve');
});

test('an unrelated spelling suggestion is not silently accepted', async () => {
  await assert.rejects(
    () => fetchWordDetails('zzzzzz', {
      storage: null,
      fetchImpl: async url => url.includes('api.languagetool.org')
        ? ({ ok: true, status: 200, async json() { return { matches: [{ rule: { issueType: 'misspelling' }, replacements: [{ value: 'banana' }] }] }; } })
        : url.includes('api.datamuse.com')
          ? ({ ok: true, status: 200, async json() { return [{ word: 'banana' }]; } })
        : ({ ok: false, status: 404 })
    }),
    error => error instanceof DictionaryApiError && error.code === 'NOT_FOUND'
  );
});

test('cached results are used when the network later fails', async () => {
  const storage = new MemoryStorage();
  await fetchWordDetails('luminous', {
    storage,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return [{ word: 'luminous', meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Emitting light.' }] }] }];
      }
    })
  });

  const cached = await fetchWordDetails('luminous', {
    storage,
    fetchImpl: async () => { throw new TypeError('offline'); }
  });
  assert.equal(cached.definition, 'Emitting light.');
  assert.equal(cached.source, 'cache');
});

test('dictionary-native examples are removed when they contradict the returned sense', async () => {
  const result = await fetchWordDetails('augment', {
    storage: new MemoryStorage(),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return [{
          word: 'augment',
          meanings: [{
            partOfSpeech: 'verb',
            definitions: [{
              definition: 'To slow the tempo or meter, e.g. for a dramatic or stately passage.',
              example: 'Augmented reality enables virtual objects to be superimposed on the real world.'
            }]
          }]
        }];
      }
    })
  });

  assert.match(result.example, /composer.*theme.*slower/i);
});
