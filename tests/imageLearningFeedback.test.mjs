import test from 'node:test';
import assert from 'node:assert/strict';
import { driveSync, MemoryStorage } from '../js/services/driveSync.js?v=18900';
import { recordImagePreference, getImageLearningStatus, getImageLearningTrainingData, resetImagePreferences, rankImagesLocally, disableImageLearning } from '../js/services/imageLearning.js?v=18900';
import { imageChoiceLabels, imageReplacementLabels } from '../js/services/imageChoicePolicy.js';
import { imageSenseFingerprint } from '../js/services/imageSearch.js?v=18900';
import { encodeFeatures, preferenceFeatures } from '../js/services/imagePreferences.js';
import { IMAGE_PREPROCESSING, encodeMeaning } from '../js/services/imagePersonalizer.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';
const word = { word: 'bank', partOfSpeech: 'noun', definition: 'Land beside a river.' };
const vector = axis => Array.from({ length: 512 }, (_, i) => Number(i === axis));
const candidate = (id, axis) => ({ url: `https://example.test/${id}.jpg`, ml: { model: CLIP_TAG, sense: imageSenseFingerprint(word), preprocessing: IMAGE_PREPROCESSING,
  meaningFeatures: encodeMeaning(vector(0)), features: encodeFeatures(preferenceFeatures(vector(axis), { selected: .4, margin: .2, unwanted: .1 })) } });
async function isolated(t) {
  const originalStorage = globalThis.localStorage, originalSettings = driveSync.getSettings();
  globalThis.localStorage = new MemoryStorage(); localStorage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true }));
  await resetImagePreferences();
  t.after(async () => { await resetImagePreferences(); disableImageLearning(); driveSync.write('keepvocab_settings', originalSettings); if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
}
test('normal choices persist full meaning/image context and never fit synchronously or overwrite the active model', async t => {
  await isolated(t);
  for (let i = 0; i < 12; i++) { const result = await recordImagePreference(word, i % 2 ? 'good' : 'wrong', candidate(String(i), i % 2)); assert.equal(result.recorded, true); assert.equal(result.trained, false); }
  const data = await getImageLearningTrainingData(); assert.equal(data.records.length, 12); assert.equal(data.model, null);
  assert.ok(data.records.every(r => r.context.definition === word.definition && r.meaningFeatures && r.preprocessing === IMAGE_PREPROCESSING));
  assert.equal(getImageLearningStatus().revision, 0);
  assert.equal((await recordImagePreference(word, 'good', candidate('1', 1))).recorded, false);
  assert.equal(driveSync.getSettings().imageLearning.records.length, 0, 'Large history stays out of settings');
  await resetImagePreferences(); assert.equal((await getImageLearningTrainingData()).records.length, 0);
});
test('Skip, Next, unavailable pixels and invalid features do not fabricate records', async t => {
  await isolated(t);
  for (const action of ['skip', 'next', 'more-like-this']) assert.equal((await recordImagePreference(word, action, candidate(action, 0))).recorded, false);
  assert.equal((await recordImagePreference(word, 'good', { ...candidate('bad', 0), ml: { model: CLIP_TAG, sense: imageSenseFingerprint(word), features: 'bad' } })).recorded, false);
  assert.equal((await recordImagePreference(word, 'wrong', { url: 'https://example.test/no-pixels.jpg' })).recorded, false);
  assert.equal((await getImageLearningTrainingData()).records.length, 0);
  const images = [{ url: 'https://example.test/fallback.jpg' }]; assert.strictEqual(await rankImagesLocally(word, images), images);
});
test('replacement preserves a prior positive and groups its comparisons as one new decision', async t => {
  await isolated(t);
  const a = candidate('old', 0), b = candidate('new', 1);
  await recordImagePreference(word, 'good', a);
  const labels = imageReplacementLabels(word, a, b);
  for (const label of labels) await recordImagePreference(label.word, label.action, label.image, label);
  const data = await getImageLearningTrainingData(); assert.deepEqual(data.records.map(r => r.label).sort(), ['fits meaning', 'fits meaning', 'less preferred']);
  const selected = data.records.find(r => r.context.imageUrl === b.url && r.labelValue === 1), comparison = data.records.find(r => r.kind === 'comparison');
  assert.equal(selected.decisionId, comparison.decisionId); assert.equal(comparison.preferredFeatures, b.ml.features);
});
test('a gallery choice archives one positive and three comparisons without manufacturing explicit negatives', async t => {
  await isolated(t);
  const labels = imageChoiceLabels(word, candidate('winner', 0), [1, 2, 3].map(i => candidate(`other-${i}`, i)));
  for (const label of labels) await recordImagePreference(word, label.action, label.image, label);
  const data = await getImageLearningTrainingData(); assert.equal(data.records.length, 4);
  assert.equal(new Set(data.records.map(r => r.decisionId)).size, 1);
  assert.equal(data.records.filter(r => r.kind === 'comparison').length, 3);
  assert.equal(data.records.filter(r => r.labelValue === 0 && r.kind !== 'comparison').length, 0);
  assert.ok(data.records.filter(r => r.kind === 'comparison').every(r => r.predictions.length === 1));
});
test('corrections preserve the old event in history while adding the new pair direction and explicit rejections separately', async t => {
  await isolated(t); const a = candidate('a', 0), b = candidate('b', 1);
  assert.equal((await recordImagePreference(word, 'less-preferred', a)).recorded, false);
  assert.equal((await recordImagePreference(word, 'less-preferred', a, { preferredImage: a })).recorded, false);
  await recordImagePreference(word, 'less-preferred', a, { preferredImage: b });
  await recordImagePreference(word, 'less-preferred', b, { preferredImage: a });
  await recordImagePreference(word, 'wrong', b);
  const data = await getImageLearningTrainingData(); assert.equal(data.records.length, 3);
  assert.equal(new Set(data.records.filter(r => r.kind === 'comparison').map(r => r.key)).size, 1);
  assert.deepEqual(data.records.map(r => r.label).sort(), ['less preferred', 'less preferred', 'wrong meaning']);
});
