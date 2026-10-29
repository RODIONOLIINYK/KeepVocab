import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readJsonFile } from '../scripts/lib/json-files.mjs';
import { validatePretrainingBenchmark } from '../scripts/lib/image-pretraining-benchmark.mjs';
import { auditMeaningShiftSplit, pairedShiftDifference } from '../scripts/lib/image-meaning-shift.mjs';
import { trainingMetrics } from '../scripts/lib/image-training-diagnostics.mjs';
import { IMAGE_TRAINING_RECIPE } from '../js/ml/imageTrainingRecipe.js';

const plan = await readJsonFile('tests/fixtures/image-meaning-shift/split.json');
const manifest = await readJsonFile(plan.sourceManifest), encoded = await readJsonFile(plan.sourceFeatures);
const original = validatePretrainingBenchmark(encoded, manifest);
test('same-meaning experiment preserves all original data and keeps candidate photos disjoint', async () => {
  for (const file of plan.preservation) assert.equal(createHash('sha256').update(await readFile(file.path)).digest('hex'), file.sha256);
  const seen = auditMeaningShiftSplit(original, plan, 'seen'), unseen = auditMeaningShiftSplit(original, plan, 'unseen');
  assert.equal(seen.summary.train.galleries, unseen.summary.train.galleries);
  assert.equal(seen.summary.train.meanings, unseen.summary.train.meanings);
  assert.equal(seen.summary.validation.meanings, plan.retainedTargets);
  assert.equal(seen.summary.test.meanings, plan.retainedTargets);
  assert.deepEqual(seen.split.test.map(row => row.id), unseen.split.test.map(row => row.id));
  const used = new Set([...plan.commonIds, ...plan.seenExposureIds, ...plan.unseenExposureIds, ...plan.validationIds, ...plan.testIds, ...plan.preservedOutsideExperimentIds]);
  assert.equal(used.size, manifest.cases.length);
});
test('new experiment rejects photo leakage and an unseen target in a same-meaning arm', () => {
  const leak = structuredClone(plan); leak.commonIds.push(plan.validationIds[0]);
  assert.throws(() => auditMeaningShiftSplit(original, leak, 'seen'), /leakage|repeated gallery/);
  const unseen = structuredClone(plan); unseen.seenExposureIds = [...unseen.unseenExposureIds];
  assert.throws(() => auditMeaningShiftSplit(original, unseen, 'seen'), /meaning coverage/);
});
test('paired shift analysis compares identical meanings and handles no discordant predictions', () => {
  const rows = [0, 1, 2].map(i => ({ id: String(i), meaningId: `m${i}`, chosenAt1: 0, loss: .7 }));
  const perfect = rows.map(row => ({ ...row, chosenAt1: 1, loss: .1 }));
  const result = pairedShiftDifference({ rows }, { rows: perfect }, { samples: 100 });
  assert.equal(result.improved, 3); assert.equal(result.worsened, 0);
  assert.equal(result.metrics.accuracy.meanDifference, 1); assert.equal(result.metrics.accuracy.lower95, 1);
  assert.equal(pairedShiftDifference({ rows }, { rows }, { samples: 100 }).exactDiscordanceP, 1);
  assert.throws(() => pairedShiftDifference({ rows }, { rows: [...perfect].reverse() }), /do not match/);
});

test('archived meaning-shift heads reproduce the frozen held-out results with the shared recipe', async () => {
  const report = await readJsonFile('docs/image-meaning-shift/report.json');
  const independent = await readJsonFile('docs/image-meaning-shift/independent-verification.json');
  assert.equal(independent.passed, true); assert.equal(independent.rankChecks, 36);
  assert.equal(report.runs.length, 6); assert.equal(report.activated, false);
  assert.equal(report.baseline.test.chosenAt1, 20); assert.equal(report.baseline.test.choices, 21);
  for (const run of report.runs) {
    const saved = await readJsonFile(`tests/fixtures/image-meaning-shift/models/${run.seed}-${run.arm}.json.gz`);
    assert.deepEqual(saved.provenance.recipe, IMAGE_TRAINING_RECIPE); assert.equal(saved.testEvaluated, false);
    const audit = auditMeaningShiftSplit(original, plan, run.arm);
    for (const checkpoint of ['selected', 'last']) {
      const model = saved[checkpoint], bytes = Buffer.alloc(model.weights.length * 4);
      model.weights.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), run[`${checkpoint}WeightsSha256`]);
      const actual = trainingMetrics(model, audit.split.test, audit.cases);
      assert.equal(actual.chosenAt1, run.metrics.test[checkpoint].chosenAt1);
      assert.ok(Math.abs(actual.loss-run.metrics.test[checkpoint].loss) < 1e-12);
    }
  }
  assert.equal(report.meanPaired.selected.metrics.accuracy.meanDifference, 0);
  assert.equal(report.meanPaired.selected.exactDiscordanceP, null);
});
