import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validMeaningCategoryClassifier, meaningCategoryProbabilities } from '../scripts/lib/meaning-category-classifier.mjs';

const root = new URL('../', import.meta.url);
const bytes = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await bytes(path));
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = 'tests/fixtures/meaning-taxonomy/regularized-expansion/';
const output = 'docs/meaning-taxonomy-training/regularized-expansion/';

test('regularized and frozen previous heads reproduce Python probabilities and test errors', async () => {
  const encoded = JSON.parse(gunzipSync(await bytes(`${fixture}embeddings.json.gz`)));
  assert.equal(encoded.datasetFileSha256, hash(await bytes(`${fixture}dataset.json`)));
  const vectors = new Map(encoded.rows.map(row => [row.id, row.vector]));
  const [selection, report, predictions] = await Promise.all([
    json(`${output}selection.json`), json(`${output}report.json`), json(`${output}test-predictions.json`)
  ]);
  assert.equal(predictions.rows.length, 48);
  for (const [name, path, field] of [
    ['selectedRegularized', selection.selectedArtifact, 'selectedProbabilities'],
    ['currentClassifier', selection.currentArtifactPath, 'currentProbabilities']
  ]) {
    const model = await json(path);
    assert(validMeaningCategoryClassifier(model));
    const counts = model.categories.map(() => ({ tp: 0, fp: 0, fn: 0 }));
    let exact = 0;
    for (const row of predictions.rows) {
      assert(!model.provenance.trainIds.includes(row.id));
      const p = meaningCategoryProbabilities(model, vectors.get(row.id));
      assert(p.every((value, i) => Math.abs(value - row[field][i]) < 1e-10));
      const predicted = p.map(value => Number(value >= model.decisionThreshold));
      if (predicted.every((value, i) => value === row.targets[i])) exact++;
      predicted.forEach((value, i) => {
        if (value && row.targets[i]) counts[i].tp++;
        else if (value) counts[i].fp++;
        else if (row.targets[i]) counts[i].fn++;
      });
    }
    const metric = report.results[name].metrics;
    assert.equal(exact / predictions.rows.length, metric.exactMatch);
    model.categories.forEach((c, i) => {
      for (const key of ['tp', 'fp', 'fn']) assert.equal(counts[i][key], metric.perClass[c][key]);
    });
  }
});

test('historical regularization head follows its frozen architecture decision and confirmation gates', async () => {
  const [selection, report, protocol] = await Promise.all([
    json(`${output}selection.json`), json(`${output}report.json`), json(`${output}protocol.json`)
  ]);
  assert.equal(selection.decisionFrozenBeforeTest, true);
  assert.equal(selection.testUsedForSelection, false);
  assert.equal(report.testUsedForSelection, false);
  assert.equal(report.selectionFileSha256, hash(await bytes(`${output}selection.json`)));
  assert.equal(selection.protocolFileSha256, hash(await bytes(`${output}protocol.json`)));
  assert.equal(selection.datasetFileSha256, hash(await bytes(`${fixture}dataset.json`)));
  assert.equal(selection.embeddingsFileSha256, hash(await bytes(`${fixture}embeddings.json.gz`)));
  assert.equal(selection.selectedFamily, selection.linearPracticalEquivalence.passed ? 'linear' : '32');
  assert.equal(selection.selected.artifactCopySha256, hash(await bytes(selection.selectedArtifact)));
  assert.equal(selection.currentArtifactSha256, hash(await bytes(selection.currentArtifactPath)));
  assert.equal(report.promotionGate.eligibleForRegistryUpdate,
    selection.validationPromotionGate.passed && Object.values(report.promotionGate.testChecks).every(Boolean));
  const expectedPath = report.promotionGate.eligibleForRegistryUpdate
    ? selection.selectedArtifact : selection.currentArtifactPath;
  const expectedHash = report.promotionGate.eligibleForRegistryUpdate
    ? selection.selected.artifactCopySha256 : selection.currentArtifactSha256;
  assert.equal(expectedHash, hash(await bytes(expectedPath)));
  assert.equal(protocol.scoredOriginalRows, 750);
  assert.equal(protocol.trainingRows, 890);
  assert.equal(protocol.validationRows, 48);
});

test('L1, L2 and elastic-net finalists are valid, content-bound six-probability heads', async () => {
  const selection = await json(`${output}selection.json`);
  assert.equal(selection.configurationCount, 72);
  assert.equal(selection.finalists.length, 12);
  assert.equal(Object.keys(selection.byArchitectureAndRegularizer).length, 6);
  for (const finalist of selection.finalists) {
    const path = `${fixture}${finalist.artifact}`;
    const model = await json(path);
    assert.equal(finalist.artifactFileSha256, hash(await bytes(path)));
    assert(validMeaningCategoryClassifier(model));
    assert.equal(model.provenance.protocolFileSha256, selection.protocolFileSha256);
    assert.equal(model.provenance.testUsedForSelection, false);
    assert.equal(model.provenance.legacyEvaluationUsedForSelection, false);
    assert.equal(finalist.regularization.biasesPenalized, false);
    const values = model.layers.flatMap(layer => layer.weights.flat());
    assert.equal(values.filter(value => value === 0).length, finalist.parameters.exactZeroWeights);
  }
});
