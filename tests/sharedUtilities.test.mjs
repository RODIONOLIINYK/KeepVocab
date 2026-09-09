import test from 'node:test';
import assert from 'node:assert/strict';

import { clearImageSelectionPatch, imageSelectionPatch, imageUrlsForWords } from '../js/services/imageSearch.js';
import { shuffleItems, shuffleSentenceTokens } from '../js/utils/collections.js';
import { localDateKey } from '../js/utils/dates.js';
import { navigateTo } from '../js/utils/navigation.js';

test('shared navigation keeps same-route callbacks and hash navigation behavior', () => {
  const sameLocation = { hash: '#library' };
  const calls = [];
  navigateTo('library', view => calls.push(view), sameLocation);
  assert.deepEqual(calls, ['library']);
  assert.equal(sameLocation.hash, '#library');

  const nextLocation = { hash: '#dashboard' };
  navigateTo('library', view => calls.push(view), nextLocation);
  assert.equal(nextLocation.hash, 'library');
  assert.deepEqual(calls, ['library']);
});

test('shared shuffle preserves the input and uses the existing Fisher-Yates order', () => {
  const values = [1, 2, 3, 4];
  const randomValues = [0.1, 0.7, 0.2];
  const shuffled = shuffleItems(values, () => randomValues.shift());
  assert.deepEqual(values, [1, 2, 3, 4]);
  assert.deepEqual(shuffled, [2, 4, 3, 1]);
});

test('sentence tiles never start solved even when random shuffle returns their original order', () => {
  const tokens = ['Aš', 'esu', 'studentas'];
  const shuffled = shuffleSentenceTokens(tokens, 'Aš esu studentas.', () => .999);
  assert.notDeepEqual(shuffled, tokens);
  assert.deepEqual([...shuffled].sort(), [...tokens].sort());
  assert.deepEqual(tokens, ['Aš', 'esu', 'studentas']);
  assert.deepEqual(shuffleSentenceTokens(['aš'], 'Aš.', () => 0), ['aš']);
  const repeated = shuffleSentenceTokens(['labai', 'labai', 'gerai'], 'Labai labai gerai.', () => .999);
  assert.notEqual(repeated.join(' '), 'labai labai gerai');
});

test('shared local date keys preserve the existing calendar format', () => {
  assert.equal(localDateKey(new Date(2026, 7, 3, 23, 59)), '2026-08-03');
});

test('shared image helpers preserve metadata, fallback query, clearing, and exclusions', () => {
  const image = {
    url: 'https://images.example/cue.jpg',
    sourceUrl: 'https://source.example/cue',
    attribution: 'Example photographer',
    license: 'Example license'
  };
  assert.deepEqual(imageSelectionPatch(image, 'fallback concept'), {
    imageUrl: image.url,
    imageSourceUrl: image.sourceUrl,
    imageAttribution: image.attribution,
    imageLicense: image.license,
    imageSearchQuery: 'fallback concept'
  });
  assert.deepEqual(clearImageSelectionPatch(), {
    imageUrl: '', imageSourceUrl: '', imageAttribution: '', imageLicense: '', imageSearchQuery: ''
  });
  assert.deepEqual(imageUrlsForWords([
    { id: 'current', imageUrl: image.url, imageSourceUrl: image.sourceUrl },
    { id: 'other', imageUrl: ' https://images.example/other.jpg ', imageSourceUrl: '' }
  ], { excludeWordId: 'current' }), ['https://images.example/other.jpg']);
});
