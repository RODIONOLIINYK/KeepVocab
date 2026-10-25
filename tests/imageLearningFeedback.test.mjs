import test from 'node:test';
import assert from 'node:assert/strict';
import { driveSync, MemoryStorage } from '../js/services/driveSync.js?v=18900';
import { recordImagePreference, getImageLearningStatus, getImageLearningTrainingData, resetImagePreferences, rankImagesLocally } from '../js/services/imageLearning.js?v=18900';
import { imageReplacementLabels, imageChoiceLabels } from '../js/services/imageChoicePolicy.js';
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

test('replacing a suitable image preserves its suitability label and learns a separate relative preference', async t => {
  isolated(t);
  const firstChoice = {
    ...candidate('river-old', 0),
    sourceUrl: 'https://source.example/river-old'
  };
  const firstResult = await recordImagePreference(word, 'good', firstChoice);
  assert.equal(firstResult.recorded, true);
  let records = driveSync.getSettings().imageLearning.records;
  assert.equal(records.length, 1);
  assert.equal(records[0].label, 1);
  const originalPositiveId = records[0].id;

  // Simulate Library Edit where the saved word only stores url/sourceUrl on the previous image
  const previousFromSavedWord = { url: firstChoice.url, sourceUrl: firstChoice.sourceUrl, searchQuery: 'river bank' };
  const replacementChoice = {
    ...candidate('river-new', 1),
    sourceUrl: 'https://source.example/river-new'
  };
  const labels = imageReplacementLabels(word, previousFromSavedWord, replacementChoice);
  assert.equal(labels.length, 2);
  assert.equal(labels[0].action, 'good');
  assert.equal(labels[1].action, 'less-preferred');

  for (const item of labels) {
    const res = await recordImagePreference(item.word, item.action, item.image, { preferredImage: item.preferredImage });
    assert.equal(res.recorded, true);
  }

  records = driveSync.getSettings().imageLearning.records;
  assert.equal(records.length, 3);
  const replacedEntry = records.find(record => record.id === originalPositiveId);
  assert.ok(replacedEntry, 'Previous image entry should still be keyed by its canonical ID');
  assert.equal(replacedEntry.label, 1, 'Another image being preferred does not make the old image a wrong meaning');
  assert.equal(records.filter(record => record.label === 1).length, 2);
  assert.equal(records.filter(record => record.kind === 'comparison').length, 1);

  const trainingData = getImageLearningTrainingData();
  assert.deepEqual(trainingData.records.map(r => r.label).sort(), ['fits meaning', 'fits meaning', 'less preferred']);
});

test('ordinary viewed-gallery choices train without explicit rejections and do not inflate the intercept', async t => {
  isolated(t);
  for (let choice = 0; choice < 2; choice++) {
    const winner = candidate(`winner-${choice}`, 0);
    const viewed = [1, 2, 3].map((_, index) => candidate(`viewed-${choice}-${index}`, 1));
    for (const item of imageChoiceLabels(word, winner, viewed)) {
      assert.equal((await recordImagePreference(item.word, item.action, item.image, { preferredImage: item.preferredImage })).recorded, true);
    }
  }
  const status = getImageLearningStatus();
  assert.equal(status.labels, 8);
  assert.equal(status.positiveLabels, 2);
  assert.equal(status.negativeLabels, 0);
  assert.equal(status.comparisons, 6);
  assert.equal(status.trainedLabels, 8);
  assert.ok(status.deltaL2 > 0);
  const model = getImageLearningTrainingData().model;
  assert.equal(model.weights.at(-1), 0, 'Pairwise preferences cannot create positive-only classifier bias');
  assert.ok(model.weights[0] > model.weights[1]);
});

test('reversing a comparison updates one pair and explicit wrong remains distinct', async t => {
  isolated(t);
  const a = candidate('a', 0);
  const b = candidate('b', 1);
  assert.equal((await recordImagePreference(word, 'less-preferred', a)).recorded, false);
  assert.equal((await recordImagePreference(word, 'less-preferred', a, { preferredImage: a })).recorded, false);
  assert.equal((await recordImagePreference(word, 'less-preferred', a, { preferredImage: b })).recorded, true);
  assert.equal((await recordImagePreference(word, 'less-preferred', a, { preferredImage: b })).recorded, false);
  assert.equal((await recordImagePreference(word, 'less-preferred', b, { preferredImage: a })).recorded, true);
  let records = driveSync.getSettings().imageLearning.records;
  assert.equal(records.length, 1);
  assert.equal(records[0].features, b.ml.features);
  assert.equal(records[0].preferredFeatures, a.ml.features);
  assert.equal((await recordImagePreference(word, 'wrong', b)).recorded, true);
  records = getImageLearningTrainingData().records;
  assert.deepEqual(records.map(item => item.label).sort(), ['less preferred', 'wrong meaning']);
});
