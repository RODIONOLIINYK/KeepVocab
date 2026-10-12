import test from 'node:test';
import assert from 'node:assert/strict';

import { DictionaryApiError, fetchWordDetails, translateEnglishText, withUkrainianTranslations } from '../js/services/dictionaryApi.js';
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
    force: true,
    fetchImpl: async () => { throw new TypeError('offline'); }
  });
  assert.equal(cached.definition, 'Emitting light.');
  assert.equal(cached.source, 'cache');
});

test('fresh dictionary results avoid repeated provider requests', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return [{ word: 'luminous', meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Emitting light.' }] }] }];
      }
    };
  };
  await fetchWordDetails('luminous', { storage, fetchImpl });
  const cached = await fetchWordDetails('luminous', { storage, fetchImpl });
  assert.equal(calls, 1);
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

test('Ukrainian translation requests use en|uk and cached translations work offline', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const translation = await translateEnglishText('Move on foot.', {
    storage,
    fetchImpl: async url => {
      calls += 1;
      const request = new URL(url);
      assert.equal(request.hostname, 'api.mymemory.translated.net');
      assert.equal(request.searchParams.get('langpair'), 'en|uk');
      assert.equal(request.searchParams.get('q'), 'Move on foot.');
      return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Пересуватися пішки.' } }) };
    }
  });
  assert.equal(translation, 'Пересуватися пішки.');
  assert.equal(await translateEnglishText(' Move  on foot. ', { storage, fetchImpl: async () => assert.fail('Cache should avoid a request') }), translation);
  assert.equal(await translateEnglishText('Move on foot.', { storage, force: true, fetchImpl: async () => { throw new TypeError('offline'); } }), translation);
  assert.equal(calls, 1);
});

test('echoed English text and translation quota errors are never saved as Ukrainian meanings', async () => {
  for (const payload of [
    { responseStatus: 200, responseData: { translatedText: 'Move on foot.' } },
    { responseStatus: 403, responseData: { translatedText: 'Ліміт перекладів вичерпано.' } }
  ]) {
    const storage = new MemoryStorage();
    await assert.rejects(translateEnglishText('Move on foot.', { storage, fetchImpl: async () => ({ ok: true, json: async () => payload }) }));
    assert.equal(storage.getItem('keepvocab_ukrainian_translation_cache_v1'), null);
  }
});

test('sense translations keep English meanings, examples, and saved morphology intact', async () => {
  const entry = { word: 'bank', phonetic: '/bæŋk/', senses: [
    { id: 'money', definition: 'A financial institution.', example: 'I went to the bank.', translation: 'A financial institution.', acceptedForms: ['bank', 'banks'] },
    { id: 'river', definition: 'Land beside a river.', example: 'They sat on the bank.', translation: 'Берег річки.' }
  ] };
  const translated = await withUkrainianTranslations(entry, {
    translate: async definition => {
      assert.equal(definition, 'A financial institution.');
      return 'Фінансова установа.';
    }
  });
  assert.equal(translated.word, 'bank');
  assert.equal(translated.phonetic, entry.phonetic);
  assert.deepEqual(translated.senses.map(sense => sense.definition), entry.senses.map(sense => sense.definition));
  assert.deepEqual(translated.senses.map(sense => sense.example), entry.senses.map(sense => sense.example));
  assert.deepEqual(translated.senses[0].acceptedForms, ['bank', 'banks']);
  assert.deepEqual(translated.senses.map(sense => sense.translation), ['Фінансова установа.', 'Берег річки.']);
  assert.equal(translated.translationLanguage, 'uk');
  assert.equal(entry.senses[0].translation, entry.senses[0].definition, 'Original cache data should remain untouched.');
});

test('translation failures keep dictionary senses usable and bound further provider requests', async () => {
  let calls = 0;
  const senses = Array.from({ length: 20 }, (_, index) => ({ definition: `English sense ${index}.` }));
  const result = await withUkrainianTranslations({ word: 'bank', senses }, {
    translate: async () => { calls += 1; throw new TypeError('offline'); }
  });
  assert.ok(calls <= 3);
  assert.equal(result.senses.length, 20);
  assert.ok(result.senses.every(sense => sense.translation === '' && sense.translationLanguage === 'en'));
});

test('long English definitions are translated in complete segments within the provider byte limit', async () => {
  const source = Array.from({ length: 70 }, () => 'A detailed definition.').join(' ');
  const segments = [];
  const translated = await translateEnglishText(source, {
    storage: null,
    fetchImpl: async url => {
      const segment = new URL(url).searchParams.get('q');
      assert.ok(new TextEncoder().encode(segment).length <= 500);
      segments.push(segment);
      return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Докладне визначення.' } }) };
    }
  });
  assert.ok(segments.length > 1);
  assert.equal(segments.join(' '), source);
  assert.equal(translated, segments.map(() => 'Докладне визначення.').join(' '));
});

test('concurrent sense translations share repeated meanings and preserve every cache write', async () => {
  const storage = new MemoryStorage();
  const sources = ['A financial institution.', 'Land beside a river.'];
  let calls = 0;
  const result = await withUkrainianTranslations({ word: 'bank', senses: [
    { definition: sources[0] }, { definition: sources[1] }, { definition: sources[0] }
  ] }, {
    storage,
    fetchImpl: async url => {
      calls += 1;
      const index = sources.indexOf(new URL(url).searchParams.get('q'));
      return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: ['Фінансова установа.', 'Берег річки.'][index] } }) };
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.senses.map(sense => sense.translation), ['Фінансова установа.', 'Берег річки.', 'Фінансова установа.']);
  for (const source of sources) await translateEnglishText(source, { storage, fetchImpl: async () => assert.fail('Both cache writes must survive') });
});
