import test from 'node:test';
import assert from 'node:assert/strict';
import { driveSync, MemoryStorage } from '../js/services/driveSync.js?v=18900';
import { recordImagePreference, getImageLearningStatus, resetImagePreferences, rankImagesLocally } from '../js/services/imageLearning.js?v=18900';
import { imageSenseFingerprint } from '../js/services/imageSearch.js?v=18900';
import { encodeFeatures, preferenceFeatures } from '../js/services/imagePreferences.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';

function isolated(t) {
  const originalStorage = globalThis.localStorage;
  const originalSettings = driveSync.getSettings();
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true }));
  driveSync.updateSettings({ imageLearning: { records: [], resetAt: '' } });
  t.after(() => { driveSync.write('keepvocab_settings', originalSettings); if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
}
const word = { word: 'bank', partOfSpeech: 'noun', definition: 'Land beside a river.' };
const candidate = (id, axis) => ({ url: `https://example.test/${id}.jpg`, ml: { model: CLIP_TAG, sense: imageSenseFingerprint(word), features: encodeFeatures(preferenceFeatures(Array.from({ length: 512 }, (_, i) => i === axis ? 1 : 0), { selected: .4, margin: .2, unwanted: .1 })) } });

test('the actual click persistence service queues labels and exposes measured parameter changes across batches', async t => {
  isolated(t);
  for (let i = 0; i < 8; i++) {
    const result = await recordImagePreference(word, i % 2 ? 'good' : 'wrong', candidate(String(i), i % 2));
    assert.equal(result.recorded, true);
    assert.equal(result.trained, i === 7);
  }
  const first = getImageLearningStatus();
  assert.equal(first.labels, 8);
  assert.equal(first.revision, 1);
  assert.ok(first.deltaL2 > 0 && first.changedParameters > 0);
  assert.equal((await recordImagePreference(word, 'good', candidate('1', 1))).recorded, false);
  for (let i = 8; i < 12; i++) {
    const result = await recordImagePreference(word, i % 2 ? 'good' : 'wrong', candidate(String(i), i % 2 + 2));
    assert.equal(result.trained, i === 11);
    assert.equal(getImageLearningStatus().revision, i < 11 ? 1 : 2);
  }
  const next = getImageLearningStatus();
  assert.equal(next.queued, 0);
  assert.equal(next.beforeFingerprint, first.fingerprint);
  assert.notEqual(next.fingerprint, first.fingerprint);
  assert.ok(next.deltaL2 > 0);
  assert.equal(JSON.parse(localStorage.getItem('keepvocab_image_preference_model_v1')).fingerprint, next.fingerprint);
  assert.equal(driveSync.getSettings().imageLearning.records.length, 12);
  resetImagePreferences();
  assert.equal(getImageLearningStatus().labels, 0);
  assert.equal(getImageLearningStatus().revision, 0);
});

test('Skip, Next, unavailable pixels and invalid features do not fabricate training labels', async t => {
  isolated(t);
  for (const action of ['skip', 'next', 'more-like-this']) assert.equal((await recordImagePreference(word, action, candidate(action, 0))).recorded, false);
  assert.equal((await recordImagePreference(word, 'good', { ...candidate('bad', 0), ml: { model: CLIP_TAG, sense: imageSenseFingerprint(word), features: 'bad' } })).recorded, false);
  assert.equal((await recordImagePreference(word, 'wrong', { url: 'https://example.test/no-pixels.jpg' })).recorded, false);
  assert.equal(getImageLearningStatus().labels, 0);
  const images = [{ url: 'https://example.test/fallback.jpg' }];
  assert.strictEqual(await rankImagesLocally(word, images), images);
  assert.equal(getImageLearningStatus().labels, 0);
});
