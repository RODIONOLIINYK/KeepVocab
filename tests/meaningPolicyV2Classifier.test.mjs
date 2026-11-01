import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { validMeaningCategoryClassifier, meaningCategoryProbabilities } from '../scripts/lib/meaning-category-classifier.mjs';
const root = new URL('../', import.meta.url);
const bytes = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await bytes(path));
const hash = value => createHash('sha256').update(value).digest('hex');
const fixture = 'tests/fixtures/meaning-taxonomy/policy-v2/';
const output = 'docs/meaning-taxonomy-training/policy-v2/';

test('v2 heads reproduce Python probabilities and confusion counts on the same fresh120 gold meanings', async () => {
  const [selection, report, predictions, encodedBytes] = await Promise.all([
    json(`${output}selection.json`), json(`${output}report.json`), json(`${output}test-predictions.json`),
    bytes(`${fixture}embeddings.json.gz`)
  ]);
  const encoded = JSON.parse(gunzipSync(encodedBytes));
  assert.equal(encoded.datasetFileSha256, hash(await bytes(`${fixture}dataset.json`)));
  const vectors = new Map(encoded.rows.map(row => [row.id, row.vector]));
  const paths = { selected: selection.selected.artifact, previousV1Head: selection.currentClassifier.artifact };
  for (const [name, trial] of [['linear', selection.bestLinearTrial], ['32', selection.best32Trial]]) {
    paths[name] = fixture + selection.finalists.find(row => row.config.trial === trial).models.find(row => row.seed === 7919).artifact;
  }
  for (const [name, record] of Object.entries(selection.controls)) paths[name] = fixture + record.artifact;
  assert.equal(predictions.rows.length, 120);
  for (const [name, path] of Object.entries(paths)) {
    const model = await json(path);
    assert(validMeaningCategoryClassifier(model));
    const counts = model.categories.map(() => ({ tp: 0, fp: 0, fn: 0 }));
    let exact = 0;
    for (const row of predictions.rows) {
      assert(!model.provenance.trainIds.includes(row.id));
      const probabilities = meaningCategoryProbabilities(model, vectors.get(row.id));
      assert(probabilities.every((value, i) => Math.abs(value - row.probabilities[name][i]) < 1e-10));
      const labels = probabilities.map(value => Number(value >= model.decisionThreshold));
      if (labels.every((value, i) => value === row.targets[i])) exact++;
      labels.forEach((value, i) => {
        if (value && row.targets[i]) counts[i].tp++;
        else if (value) counts[i].fp++;
        else if (row.targets[i]) counts[i].fn++;
      });
    }
    assert.equal(exact / 120, report.results[name].exactMatch);
    model.categories.forEach((c, i) => {
      for (const key of ['tp', 'fp', 'fn']) assert.equal(counts[i][key], report.results[name].perClass[c][key]);
    });
  }
});

test('current head is bound to v2 policy, frozen economic choice, convergence and confirmation', async () => {
  const [selection, protocol, report, registry] = await Promise.all([
    json(`${output}selection.json`), json(`${output}protocol.json`), json(`${output}report.json`),
    json('tests/fixtures/meaning-taxonomy/current-classifier.json')
  ]);
  assert.equal(selection.decisionFrozenBeforeTest, true);
  assert.equal(selection.testUsedForSelection, false);
  assert.equal(report.testUsedForArchitectureHyperparameterCalibrationOrSeedSelection, false);
  assert.equal(selection.protocolFileSha256, hash(await bytes(`${output}protocol.json`)));
  assert.equal(report.selectionFileSha256, hash(await bytes(`${output}selection.json`)));
  assert.equal(protocol.sourceFiles.runner, hash(await bytes('scripts/train-meaning-policy-v2.py')));
  assert.equal(selection.policyFileSha256, hash(await bytes(`${fixture}POLICY.md`)));
  assert.equal(selection.datasetFileSha256, hash(await bytes(`${fixture}dataset.json`)));
  assert.equal(selection.embeddingsFileSha256, hash(await bytes(`${fixture}embeddings.json.gz`)));
  assert.equal(selection.selectedArchitecture, selection.linearPracticalEquivalence.passed ? 'linear' : '32');
  assert.equal(selection.configurationCount, 77);
  assert.deepEqual(selection.seeds, [7919, 104729, 130363]);
  assert.equal(selection.exportSeed, 7919);
  assert.equal(selection.selectedOptimizerConverged, true);
  const selected = await json(selection.selected.artifact);
  assert.equal(selected.annotationPolicyVersion, 'v2');
  assert.equal(selected.annotationPolicyFileSha256, selection.policyFileSha256);
  const expected = report.promotionGate.passed ? selection.selected : selection.currentClassifier;
  assert.equal(registry.artifact, expected.artifact);
  assert.equal(registry.artifactFileSha256, hash(await bytes(expected.artifact)));
  assert.equal(registry.productionPersonalizerChanged, false);
  if (report.promotionGate.passed) assert.equal(registry.annotationPolicyVersion, 'v2');
  for (const finalist of selection.finalists) {
    assert.deepEqual(finalist.models.map(row => row.seed), selection.seeds);
    for (const record of finalist.models) {
      const model = await json(fixture + record.artifact);
      assert.equal(record.artifactFileSha256, hash(await bytes(fixture + record.artifact)));
      assert(validMeaningCategoryClassifier(model));
      assert.equal(model.provenance.testUsedForSelection, false);
      assert.equal(model.provenance.legacyEvaluationUsedForSelection, false);
      if (model.calibration.method !== 'none') {
        assert.equal(model.calibration.fitScope, 'training-only grouped out-of-fold predictions');
        assert(model.calibration.fitRows <= protocol.trainingMeaningUnits);
      }
    }
  }
});

test('label-only controls hold inputs, training records, hyperparameters and scoring fixed', async () => {
  const [oldLabels, revisedLabels, expanded] = await Promise.all([
    json(`${fixture}control-source-v1-labels.json`), json(`${fixture}control-source-v2-labels.json`),
    json(`${fixture}control-all-v2-labels.json`)
  ]);
  assert.deepEqual(oldLabels.provenance.trainIds, revisedLabels.provenance.trainIds);
  assert.deepEqual(oldLabels.preprocessor, revisedLabels.preprocessor);
  assert.deepEqual(oldLabels.hyperparameters, revisedLabels.hyperparameters);
  assert.deepEqual(oldLabels.calibration, revisedLabels.calibration);
  assert.equal(oldLabels.decisionThreshold, revisedLabels.decisionThreshold);
  assert.equal(oldLabels.provenance.trainedLabelPolicy, 'v1');
  assert.equal(revisedLabels.provenance.trainedLabelPolicy, 'v2');
  assert.deepEqual(expanded.hyperparameters, revisedLabels.hyperparameters);
  assert.deepEqual(expanded.calibration, revisedLabels.calibration);
  assert(revisedLabels.provenance.trainIds.every(id => expanded.provenance.trainIds.includes(id)));
  const dataset = await json(`${fixture}dataset.json`);
  const rows = dataset.items.filter(row => row.kind !== 'paraphrase');
  for (const word of ['shatter', 'splinter', 'erode', 'evaporate']) {
    assert(rows.filter(row => row.word === word).every(row => row.labels.includes('action') && !row.labels.includes('state')));
  }
  for (const word of ['greenhouse', 'gazebo']) {
    assert(rows.filter(row => row.word === word).every(row => row.labels.includes('entity') && row.labels.includes('place')));
  }
  for (const id of ['meaning-2213c0fe0455ab7f', 'expanded-0c90ec4bb47f3a63']) {
    const row = rows.find(row => row.id === id);
    assert(row.labels.includes('abstract') && !row.labels.includes('state'));
  }
  const visibleSad = rows.find(row => row.id === 'meaning-b6a2a6180518e3c2');
  assert.deepEqual(visibleSad.labels, ['state']);
});
