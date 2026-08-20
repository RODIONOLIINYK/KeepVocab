import test from 'node:test';
import assert from 'node:assert/strict';

import { activeImageSearchQueries, groupWordCards, imageUrlsUsedByOtherWords, mergeCurrentImageCandidate, nextImageSuggestionState, reusedImageUrls } from '../js/components/LibraryView.js';

test('library identifies an image reused by multiple meaning cards', () => {
  const duplicates = reusedImageUrls([
    { id: '1', imageUrl: 'https://images.example/shared.jpg' },
    { id: '2', imageUrl: 'https://images.example/shared.jpg' },
    { id: '3', imageUrl: 'https://images.example/unique.jpg' },
    { id: '4', imageUrl: '' }
  ]);

  assert.deepEqual([...duplicates], ['https://images.example/shared.jpg']);
});

test('library groups different meanings of the same spelling into one card', () => {
  const groups = groupWordCards([
    { id: 'bank-finance', word: 'Bank', definition: 'A financial institution.' },
    { id: 'bank-river', word: 'bank', definition: 'Land beside a river.' },
    { id: 'steady', word: 'steady', definition: 'Firmly fixed.' }
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].meanings.map(meaning => meaning.id), ['bank-finance', 'bank-river']);
});

test('identical suggested and custom concept text produces one identical search query', () => {
  const suggestion = 'worker pulling two joined metal pieces apart';
  const custom = 'worker pulling two joined metal pieces apart';
  assert.deepEqual(activeImageSearchQueries(suggestion), [suggestion]);
  assert.deepEqual(activeImageSearchQueries(custom), activeImageSearchQueries(suggestion));
});

test('More images cycles every visible concept and then advances the result page', () => {
  const scenes = ['first visible scene', 'second visible scene', 'third visible scene'];
  const second = nextImageSuggestionState(scenes, scenes[0], 1);
  const third = nextImageSuggestionState(scenes, second.concept, second.page);
  const nextPage = nextImageSuggestionState(scenes, third.concept, third.page);
  assert.deepEqual(second, { concept: scenes[1], page: 1, index: 1 });
  assert.deepEqual(third, { concept: scenes[2], page: 1, index: 2 });
  assert.deepEqual(nextPage, { concept: scenes[0], page: 2, index: 0 });
  assert.deepEqual(nextImageSuggestionState([], 'custom scene', 2), { concept: 'custom scene', page: 3, index: -1 });
});

test('a word keeps its own saved image eligible while images used by other words stay excluded', () => {
  const excluded = imageUrlsUsedByOtherWords([
    { id: 'current', imageUrl: 'https://images.example/current.jpg', imageSourceUrl: 'https://source.example/current' },
    { id: 'other', imageUrl: 'https://images.example/other.jpg', imageSourceUrl: 'https://source.example/other' }
  ], 'current');
  assert.deepEqual(excluded, ['https://images.example/other.jpg', 'https://source.example/other']);
});

test('the current saved image is always visible once and followed by new suggestions', () => {
  const current = { url: 'https://images.example/current.jpg', sourceUrl: 'https://source.example/current', isCurrent: true };
  const merged = mergeCurrentImageCandidate(current, [
    { url: current.url, sourceUrl: current.sourceUrl },
    { url: 'https://images.example/new.jpg', sourceUrl: 'https://source.example/new' }
  ]);
  assert.deepEqual(merged, [current, { url: 'https://images.example/new.jpg', sourceUrl: 'https://source.example/new' }]);
});
