import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { meaningCategoryProbabilities, validMeaningCategoryClassifier } from '../scripts/lib/meaning-category-classifier.mjs';
const root = new URL('../', import.meta.url);
const json = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const hashFile = async file => createHash('sha256').update(await readFile(new URL(file, root))).digest('hex');
const fixture = 'tests/fixtures/meaning-taxonomy/';
const results = 'docs/meaning-taxonomy-training/diagnostics/supplement/';

test('reviewed training extension preserves the frozen benchmark and exact text-vector provenance', async () => {
  const audit = spawnSync(process.execPath, [new URL('scripts/audit-meaning-supplement.mjs', root).pathname], { encoding: 'utf8' });
  assert.equal(audit.status, 0, audit.stderr);
  const [base, supplement, protocol] = await Promise.all([json(`${fixture}dataset.json`), json(`${fixture}supplement/dataset.json`), json(`${results}protocol.json`)]);
  const encoded = JSON.parse(gunzipSync(await readFile(new URL(`${fixture}supplement/embeddings.json.gz`, root))));
  assert.equal(encoded.datasetFileSha256, await hashFile(`${fixture}supplement/dataset.json`));
  assert.equal(supplement.items.length, 57);
  assert.equal(protocol.counts.expandedTraining, 301);
  assert.equal(protocol.testTargetsOrPredictionsUsed, false);
  assert.equal(protocol.hyperparametersRetuned, false);
  assert(supplement.items.every(row => row.split === 'train'));
  assert.deepEqual(new Set(encoded.rows.map(row => row.id)), new Set(supplement.items.map(row => row.id)));
  const heldout = new Set(base.items.filter(row => row.split !== 'train').map(row => row.id));
  assert(protocol.trainingIds.expanded.every(id => !heldout.has(id)));
});

test('expanded linear and 32-unit artifacts reproduce the Python validation predictions without overwriting originals', async () => {
  const predictions = await json(`${results}validation-predictions.json`);
  const encoded = JSON.parse(gunzipSync(await readFile(new URL(`${fixture}embeddings.json.gz`, root))));
  const vectors = new Map(encoded.rows.map(row => [row.id, row.vector]));
  for (const name of ['linear', '32']) {
    const model = await json(`${fixture}supplement/classifier-${name}.json`);
    const original = await json(`${fixture}${name === 'linear' ? 'classifier-linear' : 'classifier'}.json`);
    assert(validMeaningCategoryClassifier(model));
    assert.equal(model.decisionThreshold, original.decisionThreshold);
    assert.equal(model.provenance.trainIds.length, 301);
    for (const [i, row] of predictions.items.entries()) {
      const actual = meaningCategoryProbabilities(model, vectors.get(row.id));
      const expected = predictions.models[name].expanded301[i];
      assert(actual.every((p, j) => Math.abs(p - expected[j]) < 1e-10));
      const old = meaningCategoryProbabilities(original, vectors.get(row.id));
      assert(old.every((p, j) => Math.abs(p - predictions.models[name].old244[i][j]) < 1e-10));
    }
  }
});
