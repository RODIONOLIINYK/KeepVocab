import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutoSelectImage, imageChoiceLabels, imageReplacementLabels } from '../js/services/imageChoicePolicy.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';

function candidates(patch = {}) {
  const ml = { model: CLIP_TAG, sense: 'river bank', selected: .4, contrast: .2,
    margin: .2, unwanted: .05, preference: .68, score: .5, ...patch };
  return [{ url: 'https://example.test/a.jpg', ml }, { url: 'https://example.test/b.jpg', ml: { ...ml, score: .4 } }];
}

test('clear semantic matches can be suggested from first use and normal choices without deliberate ratings', () => {
  assert.equal(canAutoSelectImage(candidates({ trainedLabels: 0, preference: .5 })), true);
  assert.equal(canAutoSelectImage(candidates({ trainedLabels: 40, trainedComparisons: 36, trainedPositiveLabels: 4, trainedNegativeLabels: 0 })), true);
  for (const preference of [undefined, .2, .68, .9]) assert.equal(canAutoSelectImage(candidates({ preference })), true);
});

test('semantic ambiguity, unsuitable content and a close runner-up still require a choice', () => {
  for (const patch of [{ margin: 0 }, { margin: -.1 }, { unwanted: .4 }, { selected: .1 }, { score: .42 }]) {
    assert.equal(canAutoSelectImage(candidates({ ...patch, preference: 1, trainedLabels: 256 })), false);
  }
  assert.equal(canAutoSelectImage(candidates({ contrast: null, margin: 0, selected: .37 })), false);
  assert.equal(canAutoSelectImage(candidates({ contrast: null, margin: 0, selected: .4 })), true);
  const images = candidates();
  assert.equal(canAutoSelectImage([...images, { ...images[1], ml: { ...images[1].ml, score: .49 } }]), false);
});

test('automatic suggestions require usable scores from the same meaning for every alternative', () => {
  assert.equal(canAutoSelectImage(), false);
  assert.equal(canAutoSelectImage([]), false);
  assert.equal(canAutoSelectImage(candidates().slice(0, 1)), false);
  const [first, second] = candidates();
  for (const alternative of [null, { ...second, url: '' }, { ...second, ml: undefined },
    { ...second, ml: { ...second.ml, model: 'other' } }, { ...second, ml: { ...second.ml, sense: 'financial bank' } },
    { ...second, ml: { ...second.ml, score: NaN } }, { ...second, ml: { ...second.ml, selected: NaN } }]) {
    assert.equal(canAutoSelectImage([first, alternative]), false);
  }
  for (const patch of [{ sense: '' }, { sense: undefined }, { selected: NaN }, { margin: NaN }, { unwanted: NaN }, { score: NaN }]) {
    assert.equal(canAutoSelectImage(candidates(patch)), false);
  }
});

test('ordinary choices create bounded relative preferences only for supplied viewed alternatives', () => {
  const word = { word: 'run' };
  const selected = { url: 'running-fox', sourceUrl: 'source-running' };
  const viewed = [{ url: 'running-fox' }, { url: 'alias', sourceUrl: 'source-running' },
    { url: 'standing-fox', sourceUrl: 'source-standing' }, { url: 'standing-copy', sourceUrl: 'source-standing' },
    { url: 'running-side' }, { url: 'running-front' }, { url: 'fourth-alternative' }];
  const labels = imageChoiceLabels(word, selected, viewed);
  assert.deepEqual(labels.map(item => [item.action, item.image.url]), [
    ['good', 'running-fox'], ['less-preferred', 'standing-fox'], ['less-preferred', 'running-side'], ['less-preferred', 'running-front']
  ]);
  assert.ok(labels.slice(1).every(item => item.preferredImage === selected));
  assert.deepEqual(imageChoiceLabels(word, selected).map(item => item.action), ['good']);
  assert.deepEqual(imageChoiceLabels(word, null, viewed), []);
  assert.deepEqual(imageReplacementLabels(word, viewed[2], selected).map(item => item.action), ['good', 'less-preferred']);
});
