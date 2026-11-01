import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validMeaningCategoryClassifier, meaningCategoryProbabilities } from '../scripts/lib/meaning-category-classifier.mjs';

const root = new URL('../', import.meta.url);
const bytes = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await bytes(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = 'docs/meaning-taxonomy-training/dropout/';
const fixture = 'tests/fixtures/meaning-taxonomy/dropout/';

test('dropout experiment inference matches Python on each fixed regression cohort', async () => {
  const [selection, protocol, report, predictions, embeddings] = await Promise.all([
    json(`${output}selection.json`), json(`${output}protocol.json`), json(`${output}report.json`),
    json(`${output}test-predictions.json`),
    bytes('tests/fixtures/meaning-taxonomy/regularized-expansion/embeddings.json.gz')
  ]);
  const vectors = new Map(JSON.parse(gunzipSync(embeddings)).rows.map(row => [row.id, row.vector]));
  const paths = {
    candidate: selection.selected.artifact,
    currentLBFGS: selection.currentClassifier.artifact,
    fixedLinear: protocol.fixedLinearComparator
  };
  for (const [name, trial] of [
    ['matchedAdamControl', selection.dropoutDecision.matchedControlTrial],
    ['dropoutAlternative', selection.dropoutDecision.dropoutTrial]
  ]) {
    const finalist = selection.finalists.find(row => row.config.trial === trial);
    const model = finalist.models.find(row => row.seed === 7919);
    paths[name] = fixture + model.artifact;
  }
  for (const [name, path] of Object.entries(paths)) {
    const model = await json(path);
    assert(validMeaningCategoryClassifier(model));
    assert.equal(model.inputDimension, 512);
    assert.equal(model.categories.length, 6);
    for (const [cohort, rows] of Object.entries(predictions.cohorts)) {
      assert.equal(rows.length, cohort === 'retired-original-120' ? 120 : 48);
      const counts = model.categories.map(() => ({ tp: 0, fp: 0, fn: 0 }));
      let exact = 0;
      for (const row of rows) {
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
      const metrics = report.results[cohort][name];
      assert.equal(exact / rows.length, metrics.exactMatch);
      model.categories.forEach((category, i) => {
        for (const key of ['tp', 'fp', 'fn']) assert.equal(counts[i][key], metrics.perClass[category][key]);
      });
    }
  }
});

test('historical dropout selection and label freeze are content-bound', async () => {
  const [selection, protocol, report, audit] = await Promise.all([
    json(`${output}selection.json`), json(`${output}protocol.json`), json(`${output}report.json`),
    json(`${output}label-audit.json`)
  ]);
  assert.equal(selection.decisionFrozenBeforeTest, true);
  assert.equal(selection.testUsedForSelection, false);
  assert.equal(report.freshBlindConfirmation, false);
  assert.equal(report.testUsedForHyperparameterOrSeedSelection, false);
  assert.equal(report.labelsChanged, false);
  assert.equal(report.productionPersonalizerChanged, false);
  assert.equal(selection.protocolFileSha256, hash(await bytes(`${output}protocol.json`)));
  assert.equal(report.selectionFileSha256, hash(await bytes(`${output}selection.json`)));
  assert.equal(protocol.datasetFileSha256, hash(await bytes(audit.dataset)));
  assert.equal(protocol.sources.trainer, hash(await bytes('scripts/lib/meaning_dropout.py')));
  assert.equal(protocol.sources.runner, hash(await bytes('scripts/train-meaning-dropout.py')));
  assert.equal(audit.datasetFileSha256, protocol.datasetFileSha256);
  assert.equal(audit.findings.length, 15);
  assert(audit.findings.every(row => row.primaryReview.status === 'reviewed individually' && !row.primaryReview.labelApplied));
  assert.equal(selection.configurationCount, 24);
  assert.deepEqual(selection.seeds, [7919, 104729, 130363]);
  assert.equal(selection.selected.fixedSeed, 7919);
  const expected = report.offlinePromotionEligible ? selection.selected : selection.currentClassifier;
  assert.equal(expected.artifactFileSha256, hash(await bytes(expected.artifact)));
  assert.equal(selection.selected.artifactFileSha256, hash(await bytes(selection.selected.artifact)));
  for (const finalist of selection.finalists) {
    assert.deepEqual(finalist.models.map(row => row.seed), selection.seeds);
    for (const record of finalist.models) {
      const path = fixture + record.artifact;
      assert.equal(record.artifactFileSha256, hash(await bytes(path)));
      const model = await json(path);
      assert(validMeaningCategoryClassifier(model));
      assert.equal(model.provenance.trainingOnlyDropout, finalist.config.dropout);
      assert.equal(model.provenance.inferenceDropout, false);
      assert.equal(model.provenance.protocolFileSha256, selection.protocolFileSha256);
    }
  }
});

test('nested early stopping never monitors an outer held-out meaning group', async () => {
  const [protocol, trials, dataset] = await Promise.all([
    json(`${output}protocol.json`), json(`${output}trials.json`),
    json('tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json')
  ]);
  const rows = new Map(dataset.items.map(row => [row.id, row]));
  for (const run of trials) {
    assert.equal(run.fits.length, 4);
    for (const [fold, fit] of run.fits.entries()) {
      const training = new Set(protocol.outerFolds[fold].trainIds);
      const heldOutGroups = new Set(protocol.outerFolds[fold].validationIds.map(id => rows.get(id).groupId));
      assert(fit.innerMonitorIds.every(id => training.has(id) && !heldOutGroups.has(rows.get(id).groupId)));
      assert(fit.innerMonitorIds.every(id => rows.get(id).kind !== 'paraphrase'));
      assert.equal(fit.earlyStopping, false); // Whole outer-training refit uses the inner-selected epoch.
      assert.equal(fit.innerStop.earlyStopping, true);
      assert.equal(fit.epochsExecuted, fit.innerStop.selectedEpoch);
      assert.equal(fit.dropoutAtInference, false);
    }
  }
});
