import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_TAG } from '../js/ml/clipConfig.js';
import { normalizedVector, preferenceFeatures, encodeFeatures, decodeFeatures, fitPreferences, updatePreferenceModel, preferenceProbability, mergeImageLearning, MAX_LABELS } from '../js/services/imagePreferences.js';
import { rankEmbeddedImages, semanticScores } from '../js/services/imageLearning.js?v=18900';
import { mergeDriveSettings } from '../js/services/driveSync.js';
const vector = index => Array.from({ length: 512 }, (_, i) => i === index ? 1 : 0);
const features = index => preferenceFeatures(vector(index), { selected: 0.4, margin: 0.15, unwanted: 0.1 });
const record = (id, label, index = label ? 0 : 1, date = '2026-10-22T10:00:00.000Z') => ({ id, label, model: CLIP_TAG, features: encodeFeatures(features(index)), updatedAt: date });
const initial = Array.from({ length: 8 }, (_, i) => record(String(i), i % 2));

test('real gradients update parameters from zero and prefer the positively labelled embedding', () => {
  const model = fitPreferences(initial);
  assert.ok(model.deltaL2 > 0);
  assert.ok(model.changedParameters > 0);
  assert.notEqual(model.beforeFingerprint, model.fingerprint);
  assert.ok(preferenceProbability(model, features(0)) > preferenceProbability(model, features(1)));
  assert.equal(model.revision, 1);
  assert.deepEqual(initial.map(item => item.features), initial.map(item => encodeFeatures(decodeFeatures(item.features))));
});

test('each click is retained but parameters stay fixed until four changed labels form a replay batch', () => {
  let data = { records: initial };
  let model = updatePreferenceModel(data).model;
  const firstFingerprint = model.fingerprint;
  for (let i = 8; i < 12; i++) {
    data = mergeImageLearning(data, { records: [record(String(i), i % 2, i % 2 ? 2 : 3)] });
    const next = updatePreferenceModel(data, model);
    if (i < 11) {
      assert.equal(next.trained, false);
      assert.equal(next.model.fingerprint, firstFingerprint);
      assert.equal(next.model.revision, 1);
      assert.equal(next.queued, i - 7);
    } else {
      assert.equal(next.trained, true);
      assert.equal(next.model.revision, 2);
      assert.ok(next.model.deltaL2 > 0);
      assert.notEqual(next.model.fingerprint, firstFingerprint);
    }
    model = next.model;
  }
});

test('repeated identical clicks do not overweight a label or produce fake parameter revisions', () => {
  const data = mergeImageLearning({ records: initial }, { records: initial });
  assert.equal(data.records.length, 8);
  const first = updatePreferenceModel(data).model;
  const duplicate = updatePreferenceModel(data, first);
  assert.equal(duplicate.trained, false);
  assert.equal(duplicate.queued, 0);
  assert.equal(duplicate.model.revision, 1);
  assert.equal(duplicate.model.fingerprint, first.fingerprint);
});

test('training waits for sufficient independent labels and both classes', () => {
  assert.equal(fitPreferences(initial.slice(0, 7)), null);
  assert.equal(fitPreferences(initial.map(item => ({ ...item, label: 1 }))), null);
  assert.equal(fitPreferences(initial.map((item, i) => ({ ...item, label: i === 0 ? 0 : 1 }))), null);
});

test('corrected labels replace previous labels and refit instead of retaining contradictory targets', () => {
  const model = updatePreferenceModel({ records: initial }).model;
  const corrected = mergeImageLearning({ records: initial }, { records: [record('0', 1, 4, '2026-10-22T11:00:00.000Z')] });
  assert.equal(corrected.records.length, 8);
  assert.equal(corrected.records.find(item => item.id === '0').label, 1);
  const result = updatePreferenceModel(corrected, model);
  assert.equal(result.trained, true);
  assert.ok(result.model.deltaL2 > 0);
});

test('Drive unions explicit labels, converges on concurrent edits, and reset markers prevent resurrection', () => {
  const left = { imageLearning: { records: [record('a', 1)] } };
  const right = { imageLearning: { records: [record('b', 0)] } };
  assert.equal(mergeDriveSettings(left, right).imageLearning.records.length, 2);
  const a = { records: [record('a', 1)] };const b = { records: [record('a', 0)] };
  assert.deepEqual(mergeImageLearning(a, b), mergeImageLearning(b, a));
  const reset = { resetAt: '2026-10-22T12:00:00.000Z', records: [] };
  assert.equal(mergeImageLearning(a, reset).records.length, 0);
  assert.equal(mergeImageLearning(reset, a).records.length, 0);
  assert.equal(updatePreferenceModel(reset, updatePreferenceModel({ records: initial }).model).model, null);
});

test('malformed, mismatched-model and oversized histories cannot enter training', () => {
  assert.deepEqual(mergeDriveSettings({ imageLearning: null }, { imageLearning: null }).imageLearning, { version: 1, resetAt: '', records: [] });
  const valid = record('valid', 1);
  const data = mergeImageLearning({ records: [valid, { ...valid, id: 'wrong', model: 'other' }, { ...valid, id: 'bad', features: 'x' }, { ...valid, id: 'label', label: -1 }] });
  assert.deepEqual(data.records, [valid]);
  const capped = mergeImageLearning({ records: Array.from({ length: 400 }, (_, i) => record(String(i), i % 2)) });
  assert.equal(capped.records.length, MAX_LABELS);
  assert.throws(() => normalizedVector([NaN]), /Invalid/);
  assert.throws(() => normalizedVector(Array(512).fill(0)), /Empty/);
});

test('sense contrast rejects a wrong meaning despite generic word overlap; preference contribution is bounded', () => {
  const cat = vector(0);const ship = vector(1);const document = vector(2);
  const correct = semanticScores(cat, [cat, ship, document], 0, 1);
  const wrong = semanticScores(ship, [cat, ship, document], 0, 1);
  assert.ok(correct.margin > 0 && wrong.margin < 0);
  const model = { model: CLIP_TAG, trainedLabels: 64, weights: Array(516).fill(0) };model.weights[1] = 100;
  const ranked = rankEmbeddedImages([{ candidate: { id: 'wrong' }, vector: ship, semantic: wrong }, { candidate: { id: 'correct' }, vector: cat, semantic: correct }], model);
  assert.equal(ranked[0].candidate.id, 'correct');
  assert.ok(ranked.every(item => Math.abs(item.score - item.semantic.score - 0.03 / (item.index + 1)) <= 0.060001));
  const wrongRank = ranked.find(item => item.candidate.id === 'wrong');
  assert.ok(wrongRank.score <= wrong.score + 0.03 / (wrongRank.index + 1));
  const early = rankEmbeddedImages([{ vector: ship, semantic: correct }], { ...model, trainedLabels: 8 })[0];
  assert.ok(early.score - correct.score - 0.03 <= 0.007501);
});

test('vector duplicate suppression retains a distinct visual alternative', () => {
  const semantic = { selected: 0.4, margin: 0, unwanted: 0, score: 0.4 };
  const ranked = rankEmbeddedImages([{ candidate: { id: 'a' }, vector: vector(0), semantic }, { candidate: { id: 'copy' }, vector: vector(0), semantic }, { candidate: { id: 'b' }, vector: vector(1), semantic }]);
  assert.deepEqual(new Set(ranked.map(item => item.candidate.id)), new Set(['a', 'b']));
});
