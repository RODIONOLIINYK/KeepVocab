import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { meaningCategoryProbabilities, validMeaningCategoryClassifier } from '../scripts/lib/meaning-category-classifier.mjs';

const fixture = new URL('./fixtures/meaning-taxonomy/', import.meta.url);
const root = new URL('../', import.meta.url);
const read = async url => JSON.parse(await readFile(url, 'utf8'));
const model = await read(new URL('classifier.json', fixture));
const datasetBytes = await readFile(new URL('dataset.json', fixture));
const dataset = JSON.parse(datasetBytes);
const encodedBytes = await readFile(new URL('embeddings.json.gz', fixture));
const encoded = JSON.parse(gunzipSync(encodedBytes));
const predictions = await read(new URL('docs/meaning-taxonomy-training/predictions.json', root));
const byId = new Map(encoded.rows.map(row => [row.id, row.vector]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('trained classifier provenance matches the reviewed definition embeddings', () => {
  assert(validMeaningCategoryClassifier(model));
  assert.equal(model.provenance.datasetFileSha256, sha(datasetBytes));
  assert.equal(model.provenance.embeddingsFileSha256, sha(encodedBytes));
  assert.equal(encoded.datasetFileSha256, sha(datasetBytes));
  assert.equal(model.provenance.testUsedForSelection, false);
  const sourceIds = split => dataset.items.filter(row => row.split === split).map(row => row.id);
  assert.deepEqual(model.provenance.trainIds, sourceIds('train'));
  assert.deepEqual(model.provenance.validationIds, sourceIds('validation'));
  assert(!model.provenance.trainIds.some(id => sourceIds('test').includes(id)));
});

test('portable JS inference matches Python training outputs on every non-quarantined meaning', () => {
  assert.equal(predictions.rows.length, 412);
  let maximumDifference = 0;
  for (const row of predictions.rows) {
    const actual = meaningCategoryProbabilities(model, byId.get(row.id));
    assert.equal(actual.length, 6);
    assert(actual.every(value => value >= 0 && value <= 1));
    for (let i = 0; i < 6; i++) maximumDifference = Math.max(maximumDifference, Math.abs(actual[i] - row.probabilities[i]));
  }
  assert(maximumDifference < 1e-10, `Python/JS probability mismatch: ${maximumDifference}`);
});

test('outputs retain simultaneous category membership rather than enforcing a sum of one', () => {
  assert(predictions.rows.some(row => row.probabilities.filter(value => value >= model.decisionThreshold).length > 1));
  assert(predictions.rows.some(row => Math.abs(row.probabilities.reduce((a, b) => a + b, 0) - 1) > .2));
});

test('independent JS inference reproduces held-out counts for both tuned models', async () => {
  const report = await read(new URL('docs/meaning-taxonomy-training/report.json', root));
  const linear = await read(new URL('classifier-linear.json', fixture));
  assert(validMeaningCategoryClassifier(linear));
  const testRows = dataset.items.filter(row => row.split === 'test');
  for (const [candidate, expected] of [[model, report.selected.test], [linear, report.linearChampion.test]]) {
    const counts = model.categories.map(() => ({ tp: 0, fp: 0, fn: 0 }));
    let exact = 0;
    for (const row of testRows) {
      const probabilities = meaningCategoryProbabilities(candidate, byId.get(row.id));
      const predicted = probabilities.map(value => Number(value >= candidate.decisionThreshold));
      if (JSON.stringify(predicted) === JSON.stringify(row.targets)) exact++;
      for (let i = 0; i < counts.length; i++) {
        if (predicted[i] && row.targets[i]) counts[i].tp++;
        if (predicted[i] && !row.targets[i]) counts[i].fp++;
        if (!predicted[i] && row.targets[i]) counts[i].fn++;
      }
    }
    for (let i = 0; i < counts.length; i++) for (const name of ['tp', 'fp', 'fn']) {
      assert.equal(counts[i][name], expected.perClass[model.categories[i]][name]);
    }
    assert.equal(exact / testRows.length, expected.exactMatch);
  }
});

test('malformed models, incompatible encoders and invalid input vectors are rejected', () => {
  assert(!validMeaningCategoryClassifier({ ...model, encoder: 'another-encoder' }));
  const malformed = structuredClone(model); malformed.layers[0].weights[0] = [1];
  assert(!validMeaningCategoryClassifier(malformed));
  assert.throws(() => meaningCategoryProbabilities(model, [1, 2]), /512/);
  const vector = [...byId.values()][0].slice(); vector[0] = NaN;
  assert.throws(() => meaningCategoryProbabilities(model, vector), /finite/);
});

test('post-hoc candidate preserves probability parity without replacing the original model', async () => {
  const comparison = await read(new URL('docs/meaning-taxonomy-training/comparison.json', root));
  const candidate = await read(new URL('classifier-soft-candidate.json', fixture));
  assert(validMeaningCategoryClassifier(candidate));
  assert.equal(candidate.provenance.postHocDiagnostic, true);
  assert.equal(candidate.hyperparameters.trial, 122);
  assert.equal(model.hyperparameters.trial, 81);
  for (const row of comparison.testProbabilities.softCandidate8) {
    const actual = meaningCategoryProbabilities(candidate, byId.get(row.id));
    assert(actual.every((value, i) => Math.abs(value - row.probabilities[i]) < 1e-10));
  }
  assert.equal(comparison.labelReviewChanges.primaryChanged, 33);
  assert.equal(comparison.labelReviewChanges.labelSetChanged, 55);
});
