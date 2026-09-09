import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWordsForLibrary, wordEntryToWord } from '../js/services/wordEntry.js';

test('shared save pipeline attaches an image to each chosen meaning and preserves dictionary details', async () => {
  const entry = { word: 'kava', lemma: 'kava', audioUrl: 'https://example.test/audio.mp3', senses: [{ definition: 'coffee', partOfSpeech: 'noun', acceptedForms: ['kava', 'kavos'], example: 'Norėčiau kavos.' }] };
  const word = wordEntryToWord(entry, 0, 'lithuanian');
  const result = await prepareWordsForLibrary([word], {
    existingWords: [{ id: 'old-word', imageUrl: 'https://example.test/old.jpg' }],
    findImages: async (item, options) => {
      assert.equal(item.definition, 'coffee');
      assert.deepEqual(options.excludeUrls, ['https://example.test/old.jpg']);
      return [{ url: 'https://example.test/coffee.jpg', attribution: 'Photo author', license: 'CC0' }];
    }
  });
  assert.equal(result[0].imageUrl, 'https://example.test/coffee.jpg');
  assert.equal(result[0].imageAttribution, 'Photo author');
  assert.equal(result[0].audioUrl, entry.audioUrl);
  assert.deepEqual(result[0].acceptedForms, ['kava', 'kavos']);
  assert.equal(word.imageUrl, undefined);
});

test('image failure keeps the defined word saveable; missing meanings never start image search', async () => {
  const result = await prepareWordsForLibrary([{ word: 'kava', definition: 'coffee' }], {
    courseId: 'lithuanian', findImages: async () => { throw new Error('offline'); }
  });
  assert.equal(result[0].definition, 'coffee');
  assert.equal(result[0].courseId, 'lithuanian');
  await assert.rejects(prepareWordsForLibrary([{ word: 'kava' }], {
    findImages: async () => { assert.fail('Should not search'); }
  }), /Choose a meaning/);
});
