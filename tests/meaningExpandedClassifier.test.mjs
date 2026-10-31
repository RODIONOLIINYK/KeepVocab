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
const fixture = 'tests/fixtures/meaning-taxonomy/expanded-1000/';
const output = 'docs/meaning-taxonomy-training/expanded-1000/';

test('expanded heads reproduce Python probabilities and fresh-test membership metrics', async () => {
  const encoded = JSON.parse(gunzipSync(await bytes(`${fixture}embeddings.json.gz`)));
  const vectors = new Map(encoded.rows.map(row => [row.id, row.vector]));
  const predictions = await json(`${output}test-predictions.json`);
  const report = await json(`${output}report.json`);
  assert.equal(predictions.rows.length, 120);
  for (const name of ['linear', '32']) {
    const model = await json(`${fixture}classifier-${name}.json`);
    assert(validMeaningCategoryClassifier(model));
    assert.equal(model.provenance.trainIds.length, 590);
    assert.equal(model.provenance.testUsedForSelection, false);
    const counts = model.categories.map(() => ({ tp: 0, fp: 0, fn: 0 }));
    let exact = 0;
    for (const row of predictions.rows) {
      assert(!model.provenance.trainIds.includes(row.id));
      const p = meaningCategoryProbabilities(model, vectors.get(row.id));
      assert(p.every((value, i) => Math.abs(value - row.probabilities[name][i]) < 1e-10));
      const predicted = p.map(value => Number(value >= model.decisionThreshold));
      if (predicted.every((value, i) => value === row.targets[i])) exact++;
      predicted.forEach((value, i) => {
        if (value && row.targets[i]) counts[i].tp++;
        else if (value) counts[i].fp++;
        else if (row.targets[i]) counts[i].fn++;
      });
    }
    const metric = report.results[name].test;
    assert.equal(exact / 120, metric.exactMatch);
    model.categories.forEach((c, i) => {
      for (const key of ['tp', 'fp', 'fn']) assert.equal(counts[i][key], metric.perClass[c][key]);
    });
  }
});

test('one current category head is bound to the frozen architecture decision and confirmation', async () => {
  const [registry, selection, report, protocol] = await Promise.all([
    json('tests/fixtures/meaning-taxonomy/current-classifier.json'), json(`${output}selection.json`),
    json(`${output}report.json`), json(`${output}protocol.json`)
  ]);
  assert.equal(selection.decisionFrozenBeforeTest, true);
  assert.equal(selection.testUsedForSelection, false);
  assert.equal(report.testUsedForArchitectureOrHyperparameterSelection, false);
  assert.equal(report.selectionFileSha256, hash(await bytes(`${output}selection.json`)));
  assert.equal(selection.protocolFileSha256, hash(await bytes(`${output}protocol.json`)));
  assert.equal(selection.classifierFileSha256, hash(await bytes(registry.artifact)));
  assert.equal(registry.artifactFileSha256, selection.classifierFileSha256);
  assert.equal(report.promotionGate.passed, true);
  assert.equal(registry.productionPersonalizerChanged, false);
  const expectedFamily = selection.practicalLinearComparison.passed ? 'linear' : '32';
  assert.equal(selection.selectedArchitecture, expectedFamily);
  assert.deepEqual(await bytes(registry.artifact), await bytes(`${fixture}classifier-${expectedFamily}.json`));
  assert.equal(protocol.legacyEvaluationUsedForSelection, false);
  const data = await json(`${fixture}dataset.json`);
  const train = data.items.filter(row => row.split === 'train');
  assert.deepEqual(new Set(train.map(row => row.id)), new Set(protocol.trainIds));
  assert.equal(protocol.validationIds.length, 120);
});
