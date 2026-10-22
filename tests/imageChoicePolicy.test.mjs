import test from 'node:test';
import assert from 'node:assert/strict';
import { canAutoSelectImage, imageChoiceGuidance } from '../js/services/imageChoicePolicy.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';

const status = { enabled: true, installed: true, phase: 'ready', labels: 40, trainedLabels: 40 };
function candidates(patch = {}) {
  const ml = { model: CLIP_TAG, sense: 'river bank', trainedLabels: 40, selected: .4, contrast: .2,
    margin: .2, unwanted: .05, preference: .96, score: .5, ...patch };
  return [{ url: 'https://example.test/a.jpg', ml }, { url: 'https://example.test/b.jpg', ml: { ...ml, score: .4 } }];
}

test('disabled or missing local models explain how to enable learning', () => {
  for (const state of [{ ...status, enabled: false }, { ...status, installed: false }]) {
    assert.deepEqual(imageChoiceGuidance(candidates(), state), {
      title: 'Choose an image', detail: 'Local learning is off. You can turn it on in Settings.', kind: 'manual'
    });
  }
});

test('missing photos and failed or missing scoring invite manual choice', () => {
  assert.match(imageChoiceGuidance([], status).detail, /Find photos/);
  assert.equal(imageChoiceGuidance(undefined).kind, 'manual');
  for (const [images, state] of [[candidates(), { ...status, phase: 'error' }], [[{ url: 'a' }], status], [candidates({ score: NaN }), status]]) {
    const guidance = imageChoiceGuidance(images, state);
    assert.equal(guidance.title, 'Choose an image');
    assert.match(guidance.detail, /scoring is unavailable/);
  }
});

test('new learning distinguishes saved ratings from examples used by the scored model', () => {
  const initial = imageChoiceGuidance(candidates({ trainedLabels: 0 }), { ...status, labels: 0, trainedLabels: 0 });
  assert.equal(initial.title, 'Learning your taste');
  assert.match(initial.detail, /0\/32/);
  const pending = imageChoiceGuidance(candidates({ trainedLabels: 28 }), { ...status, labels: 31, trainedLabels: 28, queued: 3 });
  assert.match(pending.detail, /28\/32/);
  assert.match(pending.detail, /31 saved/);
  assert.doesNotMatch(pending.detail, /31\/32/);
  const stale = imageChoiceGuidance(candidates({ trainedLabels: 28 }), status);
  assert.match(stale.detail, /28\/32/);
  assert.match(stale.detail, /40 saved/);
});

test('untrained ratings explain the need for both liked and rejected examples', () => {
  const guidance = imageChoiceGuidance(candidates({ trainedLabels: 0 }), { ...status, labels: 12, trainedLabels: 0 });
  assert.match(guidance.detail, /0\/32/);
  assert.match(guidance.detail, /12 saved/);
  assert.match(guidance.detail, /at least two liked and two rejected/);
  assert.match(guidance.detail, /clear match/);
});

test('enough training never promises automatic selection for an ambiguous or unsuitable match', () => {
  for (const patch of [{ preference: .7 }, { margin: 0 }, { unwanted: .4 }, { selected: .1 }]) {
    const images = candidates(patch);
    assert.equal(canAutoSelectImage(images), false);
    const guidance = imageChoiceGuidance(images, status);
    assert.equal(guidance.title, 'Your choice needed');
    assert.match(guidance.detail, /No clear winner/);
    assert.doesNotMatch(guidance.detail, /%|confidence/);
  }
  assert.equal(imageChoiceGuidance(candidates().slice(0, 1), status).title, 'Your choice needed');
});

test('automatic guidance follows the existing conservative selection gate', () => {
  const images = candidates();
  assert.equal(canAutoSelectImage(images), true);
  const guidance = imageChoiceGuidance(images, status);
  assert.equal(guidance.title, 'Selected for you');
  assert.equal(guidance.kind, 'automatic');
  assert.match(guidance.detail, /choose another/);
  assert.doesNotMatch(guidance.detail, /%|confidence/);
});
