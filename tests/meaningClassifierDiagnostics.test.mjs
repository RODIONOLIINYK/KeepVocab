import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { meaningCategoryProbabilities, validMeaningCategoryClassifier } from '../scripts/lib/meaning-category-classifier.mjs';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const base = 'docs/meaning-taxonomy-training/diagnostics/';
const report = await read(`${base}report.json`);
const protocol = await read(`${base}protocol.json`);
const encoded = JSON.parse(gunzipSync(await readFile(new URL('tests/fixtures/meaning-taxonomy/embeddings.json.gz', root))));
const vectors = new Map(encoded.rows.map(row => [row.id, row.vector]));

test('capacity check uses real reviewed meaning vectors and all six categories', () => {
  const fixture = new Set(encoded.rows.map(row => row.id));
  for (const run of report.tinyBatchFits) {
    assert.equal(run.count, 24);
    assert.equal(run.ids.length, 24);
    assert(run.ids.every(id => fixture.has(id) && protocol.trainIds.includes(id)));
    assert.equal(run.metrics.exactMatch, 1);
    assert(run.metrics.bce < .002);
    assert(Object.values(run.metrics.perClass).every(row => row.positiveSupport > 0));
  }
  assert.equal(report.fullTrain.exactMatch, 1);
  assert.equal(report.testUsed, false);
});

test('calibrated portable inference matches Python and preserves original decisions under transported threshold', async () => {
  const raw = await read('tests/fixtures/meaning-taxonomy/classifier.json');
  const calibrated = await read('tests/fixtures/meaning-taxonomy/classifier-calibrated.json');
  const predictions = await read(`${base}validation-predictions.json`);
  assert(validMeaningCategoryClassifier(calibrated));
  assert.equal(createHash('sha256').update(await readFile(new URL('tests/fixtures/meaning-taxonomy/classifier.json', root))).digest('hex'), protocol.modelFileSha256);
  assert.deepEqual(raw.layers, calibrated.layers);
  assert.equal(calibrated.probabilityReliabilityEstablished, false);
  for (const row of predictions.rows) {
    const actual = meaningCategoryProbabilities(calibrated, vectors.get(row.id));
    assert(actual.every((value, i) => Math.abs(value - row.calibrated[i]) < 1e-10));
    assert.deepEqual(actual.map(value => value >= calibrated.decisionThreshold), row.raw.map(value => value >= raw.decisionThreshold));
  }
});

test('precision candidate parity and unmet target are reported without activating or relabeling', async () => {
  const candidate = await read('tests/fixtures/meaning-taxonomy/classifier-precision-candidate.json');
  const results = await read(`${base}precision-search/report.json`);
  const predictions = await read(`${base}precision-search/validation-predictions.json`);
  assert(validMeaningCategoryClassifier(candidate));
  assert.equal(results.newConfigurations, 64);
  assert.equal(results.testUsed, false);
  assert.equal(results.labelsChanged, false);
  assert.equal(results.originalModelChanged, false);
  assert.equal(results.validationGoalMet, false);
  for (const row of predictions.rows) {
    const actual = meaningCategoryProbabilities(candidate, vectors.get(row.id));
    assert(actual.every((value, i) => Math.abs(value - row.probabilities[i]) < 1e-10));
  }
});

test('invalid confidence transforms cannot be accepted as a classifier', async () => {
  const model = await read('tests/fixtures/meaning-taxonomy/classifier-calibrated.json');
  assert(!validMeaningCategoryClassifier({ ...model, calibration: { ...model.calibration, temperature: 0 } }));
  assert(!validMeaningCategoryClassifier({ ...model, calibration: { ...model.calibration, offsets: [0] } }));
});
