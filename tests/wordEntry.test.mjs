import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBulkLearnerExplanations, prepareWordsForLibrary, wordEntryToWord } from '../js/services/wordEntry.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';

test('shared save pipeline attaches an image to each chosen meaning and preserves dictionary details', async () => {
  const entry = { word: 'coffee', lemma: 'coffee', audioUrl: 'https://example.test/audio.mp3', senses: [{ definition: 'A drink made from roasted coffee beans.', translation: 'Напій із обсмажених кавових зерен.', partOfSpeech: 'noun', acceptedForms: ['coffee', 'coffees'], example: 'I would like a coffee.' }] };
  const word = wordEntryToWord(entry);
  const result = await prepareWordsForLibrary([word], {
    existingWords: [{ id: 'old-word', imageUrl: 'https://example.test/old.jpg' }],
    findImages: async (item, options) => {
      assert.equal(item.definition, entry.senses[0].definition);
      assert.deepEqual(options.excludeUrls, ['https://example.test/old.jpg']);
      assert.equal(options.limit, 6);
      assert.equal(options.aiScenes, false);
      return [{ url: 'https://example.test/coffee.jpg', attribution: 'Photo author', license: 'CC0' }];
    }
  });
  assert.equal(result[0].imageUrl, 'https://example.test/coffee.jpg');
  assert.equal(result[0].imageAttribution, 'Photo author');
  assert.equal(result[0].audioUrl, entry.audioUrl);
  assert.deepEqual(result[0].acceptedForms, ['coffee', 'coffees']);
  assert.equal(result[0].translation, entry.senses[0].translation);
  assert.equal(result[0].translationLanguage, 'uk');
  assert.equal(word.imageUrl, undefined);
});

test('saving generates image prompts together for every exact meaning and reuses them on later searches', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'fake-key-for-per-meaning-image-scenes' }, storage, { silent: true });
  const words = [
    { word: 'notice', partOfSpeech: 'noun', definition: 'A warning about a change.', sourceDefinition: 'A formal warning of an upcoming change.' },
    { word: 'notice', partOfSpeech: 'noun', definition: 'Attention given to somebody.', sourceDefinition: 'Careful attention paid to somebody or something.' }
  ];
  const before = structuredClone(words);
  const otherMeaning = 'A short written announcement displayed publicly.';
  const scenes = ['tenant reading eviction letter beside apartment doorway', 'teacher listening closely beside child holding toy'];
  let requests = 0;
  const options = {
    storage, translationLanguage: 'en', existingWords: [{ word: 'notice', definition: otherMeaning }],
    fetchImpl: async (_url, request) => {
      requests++;
      const prompt = JSON.parse(request.body).contents[0].parts[0].text;
      const items = JSON.parse(prompt.match(/\nSenses: ([^\n]+)/)[1]);
      assert.equal(items.length, 2);
      for (const [index, item] of items.entries()) {
        assert.equal(item.definition || item.sourceDefinition, words[index].sourceDefinition);
        assert.ok(item.otherDefinitions.includes(otherMeaning));
      }
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: items.map((item, index) => ({ id: item.id, scenes: [scenes[index]] })).reverse() }) }] } }] }) };
    },
    findImages: async (item, searchOptions) => {
      const index = words.findIndex(word => word.sourceDefinition === item.sourceDefinition);
      assert.deepEqual(item.imageScenes.scenes, [scenes[index]]);
      assert.equal(searchOptions.aiScenes, false, 'provider searches reuse prepared scenes without another paid request');
      return [{ url: `https://example.test/notice-${index}.jpg`, searchQuery: scenes[index] }];
    }
  };
  const saved = await prepareWordsForLibrary(words, options);
  assert.equal(requests, 1);
  assert.deepEqual(saved.map(word => word.imageScenes.scenes), scenes.map(scene => [scene]));
  assert.equal(new Set(saved.map(word => word.imageUrl)).size, 2);
  await prepareWordsForLibrary(saved, options);
  assert.equal(requests, 1, 'valid prepared scenes survive saving and do not regenerate');
  assert.deepEqual(words, before);
});

test('image failure keeps the defined word saveable; missing meanings never start image search', async () => {
  const result = await prepareWordsForLibrary([{ word: 'coffee', definition: 'A hot drink.', translation: 'A hot drink.' }], {
    translationLanguage: 'uk',
    translate: async () => { throw new Error('offline'); },
    findImages: async () => { throw new Error('offline'); }
  });
  assert.equal(result[0].definition, 'A hot drink.');
  assert.equal(result[0].courseId, 'english');
  assert.equal(result[0].translation, '');
  assert.equal(result[0].translationLanguage, 'en');
  await assert.rejects(prepareWordsForLibrary([{ word: 'coffee' }], {
    findImages: async () => { assert.fail('Should not search'); }
  }), /Choose a meaning/);
});

test('manual meanings receive Ukrainian translations without replacing English examples', async () => {
  const result = await prepareWordsForLibrary([{ word: 'walk', definition: 'Move on foot.', example: 'We walk every day.' }], {
    translationLanguage: 'uk',
    translate: async definition => {
      assert.equal(definition, 'Move on foot.');
      return 'Пересуватися пішки.';
    },
    findImages: async () => []
  });
  assert.equal(result[0].definition, 'Move on foot.');
  assert.equal(result[0].example, 'We walk every day.');
  assert.equal(result[0].translation, 'Пересуватися пішки.');
  assert.equal(result[0].translationLanguage, 'uk');
});

test('English save mode skips translation and retains an existing Ukrainian annotation', async () => {
  const result = await prepareWordsForLibrary([
    { word: 'walk', definition: 'Move on foot.' },
    { word: 'bank', definition: 'Land beside a river.', translation: 'Берег річки.', translationLanguage: 'uk' }
  ], {
    translationLanguage: 'en',
    translate: async () => assert.fail('English mode must not request a translation'),
    findImages: async () => []
  });
  assert.equal(result[0].translation, 'Move on foot.');
  assert.equal(result[0].translationLanguage, 'en');
  assert.equal(result[1].translation, 'Берег річки.');
  assert.equal(result[1].translationLanguage, 'uk');
});

test('an empty save batch does not create an empty vocabulary record', async () => {
  assert.deepEqual(await prepareWordsForLibrary([], {
    translate: async () => assert.fail('Should not translate'),
    findImages: async () => assert.fail('Should not search')
  }), []);
});

test('missing, historical and unrelated examples never block single or bulk saving or trigger a paid repair', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'fake-key-for-optional-examples-tests' }, storage, { silent: true });
  for (const example of ['', 'I think I have ſeen your Ladyſhip in ſuch an outlandiſh one.']) {
    const result = await prepareWordsForLibrary([{ word: 'outlandish', definition: 'Strange or unfamiliar.', example }], {
      requireExamples: true, storage, aiScenes: false, fetchImpl: async () => assert.fail('Saving must not request an explanation'),
      findImages: async () => []
    });
    assert.equal(result[0].word, 'outlandish');
    assert.equal(result[0].example, '');
    assert.equal(result[0].needsExample, true);
  }
  const batch = await prepareWordsForLibrary([
    { word: 'outlandish', definition: 'Strange or unfamiliar.', example: 'some shit' },
    { word: 'walk', definition: 'Move on foot.', example: '' }
  ], { storage, aiScenes: false, fetchImpl: async () => assert.fail('No explanation request'), findImages: async () => [] });
  assert.equal(batch.length, 2);
  assert.ok(batch.every(word => word.example === ''));
});

test('bulk clarity preparation shares one compact request and preserves failed rows, word order, and sense identity', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'fake-key-for-bulk-clarity-tests' }, storage, { silent: true });
  const rows = [
    { term: 'meticulous', status: 'ready', data: { word: 'meticulous', senses: [{ id: 'sense-1', definition: 'The quality or condition of being scrupulously attentive to minute particulars.', example: '' }] } },
    { term: 'missing', status: 'manual', error: 'Not found', manualDefinition: 'My meaning' },
    { term: 'careful', status: 'ready', data: { word: 'careful', senses: [{ id: 'sense-1', definition: 'Characterized by attention and caution.', example: '' }] } }
  ];
  const before = structuredClone(rows);
  let requests = 0;
  const result = await prepareBulkLearnerExplanations(rows, { storage, fetchImpl: async (_url, options) => {
    requests += 1;
    const body = JSON.parse(options.body);
    assert.ok(body.generationConfig.maxOutputTokens < 3072);
    const prompt = body.contents[0].parts[0].text;
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\nSenses: ') + 9));
    assert.deepEqual(items.map(item => item.word), ['meticulous', 'careful']);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ senses: items.map(item => ({
      id: item.id, meaningPreserved: true, definition: 'Paying close attention to avoid mistakes.', example: `She was ${item.word} when checking the figures.`, usageNote: ''
    })) }) }] } }] }) };
  } });
  assert.equal(requests, 1);
  assert.equal(result[0].data.definition, 'Paying close attention to avoid mistakes.');
  assert.equal(result[2].data.definition, 'Paying close attention to avoid mistakes.');
  assert.equal(result[1], rows[1]);
  assert.equal(result[0].data.senses[0].id, 'sense-1');
  assert.equal(result[2].data.senses[0].id, 'sense-1');
  assert.deepEqual(rows, before);
});

test('bulk clarity preparation only rewrites the selected meaning, leaving unused dictionary senses free', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'fake-key-for-selected-meaning-tests' }, storage, { silent: true });
  const unused = { id: 'unused', definition: 'Characterized by minute attention to details.' };
  const selected = { id: 'selected', definition: 'Characterized by attention and caution.' };
  let requested = 0;
  const [result] = await prepareBulkLearnerExplanations([{ term: 'careful', status: 'ready', selectedSenseIndex: 1, data: { word: 'careful', senses: [unused, selected] } }], {
    storage, fetchImpl: async (_url, options) => {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      const senses = JSON.parse(prompt.slice(prompt.lastIndexOf('\nSenses: ') + 9));
      requested += senses.length;
      assert.equal(senses[0].sourceDefinition, selected.definition);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ senses: [{ id: '0', meaningPreserved: true,
        definition: 'Paying attention to avoid mistakes.', example: 'She was careful when checking the figures.', usageNote: '' }] }) }] } }] }) };
    }
  });
  assert.equal(requested, 1);
  assert.equal(result.data.senses[0], unused);
  assert.equal(result.data.senses[1].definition, 'Paying attention to avoid mistakes.');
});

test('bulk image Skip completes the shared save pipeline before the provider finishes and preserves prepared meanings and translations', async () => {
  const controller = new AbortController();
  let started;
  const searching = new Promise(resolve => { started = resolve; });
  let finishLate;
  const pending = prepareWordsForLibrary([
    { word: 'walk', definition: 'Move on foot.', example: '' },
    { word: 'bank', definition: 'Land beside a river.', example: '' }
  ], {
    translationLanguage: 'uk', translate: async () => 'Підготовлений переклад.', skipImagesSignal: controller.signal,
    findImages: (_word, options) => { assert.equal(options.limit, 6); started(); return new Promise(resolve => { finishLate = resolve; }); }
  });
  await searching;
  controller.abort();
  const result = await pending;
  assert.deepEqual(result.map(item => item.word), ['walk', 'bank']);
  assert.ok(result.every(item => item.translationLanguage === 'uk' && item.translation === 'Підготовлений переклад.'));
  assert.ok(result.every(item => !item.imageUrl && !item.imageCandidates));
  const before = structuredClone(result);
  finishLate([{ url: 'https://example.test/late-proposal.jpg' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result, before);
});
