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
      fetchImpl: async () => ({ ok: false, status: 404 })
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
