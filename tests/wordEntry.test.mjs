import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWordsForLibrary, wordEntryToWord } from '../js/services/wordEntry.js';

test('shared save pipeline attaches an image to each chosen meaning and preserves dictionary details', async () => {
  const entry = { word: 'coffee', lemma: 'coffee', audioUrl: 'https://example.test/audio.mp3', senses: [{ definition: 'A drink made from roasted coffee beans.', translation: 'Напій із обсмажених кавових зерен.', partOfSpeech: 'noun', acceptedForms: ['coffee', 'coffees'], example: 'I would like a coffee.' }] };
  const word = wordEntryToWord(entry);
  const result = await prepareWordsForLibrary([word], {
    existingWords: [{ id: 'old-word', imageUrl: 'https://example.test/old.jpg' }],
    findImages: async (item, options) => {
      assert.equal(item.definition, entry.senses[0].definition);
      assert.deepEqual(options.excludeUrls, ['https://example.test/old.jpg']);
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

test('new vocabulary cannot bypass a missing or historical usage example in the composer save pipeline', async () => {
  for (const example of ['', 'I think I have ſeen your Ladyſhip in ſuch an outlandiſh one.']) {
    await assert.rejects(prepareWordsForLibrary([{ word: 'outlandish', definition: 'Strange or unfamiliar.', example }], {
      requireExamples: true, settings: { enabled: false },
      findImages: async () => assert.fail('Missing examples must be resolved before image preparation')
    }), /modern example/);
  }
});
