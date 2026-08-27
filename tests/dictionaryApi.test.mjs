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

test('a failed primary lookup uses one fast exact-definition fallback without spelling-service chaining', async () => {
  const calls = [];
  const result = await fetchWordDetails('resilient', {
    storage: new MemoryStorage(),
    fetchImpl: async url => {
      calls.push(url);
      if (url.includes('freedictionaryapi.com')) return { ok: false, status: 503 };
      if (url.includes('api.datamuse.com')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{ word: 'resilient', defs: ['adj\tAble to recover quickly from difficulties.'] }];
          }
        };
      }
      throw new Error(`Unexpected URL ${url}`);
    }
  });

  assert.equal(result.word, 'resilient');
  assert.equal(result.definition, 'Able to recover quickly from difficulties.');
  assert.equal(result.source, 'datamuse');
  assert.deepEqual(calls.map(url => new URL(url).hostname), ['freedictionaryapi.com', 'api.datamuse.com']);
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

test('the maintained Wiktionary response shape returns pronunciations, quotes, and subsenses', async () => {
  const result = await fetchWordDetails('resilient', {
    storage: new MemoryStorage(),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          word: 'resilient',
          entries: [{
            partOfSpeech: 'adjective',
            pronunciations: [{ type: 'ipa', text: '/ɹɪˈzɪl.jənt/' }],
            synonyms: ['strong'],
            senses: [{
              definition: 'Returning quickly to normal after damage.',
              quotes: [{ text: 'The resilient team recovered quickly.' }],
              subsenses: [{ definition: 'Able to recover from trauma.', examples: ['She remained resilient.'] }]
            }]
          }]
        };
      }
    })
  });

  assert.equal(result.phonetic, '/ɹɪˈzɪl.jənt/');
  assert.equal(result.example, 'The resilient team recovered quickly.');
  assert.equal(result.senses.length, 2);
  assert.deepEqual(result.synonyms, ['strong']);
});

test('unreachable providers produce a network error instead of a misleading long timeout error', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => fetchWordDetails('resilient', {
      storage: null,
      timeoutMs: 20,
      fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      })
    }),
    error => error instanceof DictionaryApiError
      && error.code === 'NETWORK'
      && !/timed out/i.test(error.message)
  );
  assert.ok(Date.now() - startedAt < 250, 'Both bounded provider attempts should fail quickly in the regression test.');
});
