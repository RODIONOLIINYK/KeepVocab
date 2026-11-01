import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const directory = resolve(root, 'tests/fixtures/meaning-taxonomy/policy-v2');
const readJson = async path => JSON.parse(await readFile(resolve(directory, path), 'utf8'));

test('policy v2 fixture passes provenance and split integrity audit', () => {
  const result = spawnSync(process.execPath, ['scripts/audit-meaning-policy-v2.mjs'], {
    cwd: root, encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.count, 1780);
  assert.equal(summary.reviewedOldMeaningUnits, 1280);
  assert.equal(summary.newMeaningCount, 360);
  assert.equal(summary.counts.validation, 60);
  assert.equal(summary.counts.test, 120);
});

test('policy v2 encoder selector is mutually exclusive and embeds definitions without labels', async () => {
  const flags = ['--supplement', '--expanded', '--regularized', '--policy-v2'];
  for (let first = 0; first < flags.length; first++) {
    for (let second = first + 1; second < flags.length; second++) {
      const result = spawnSync(process.execPath,
        ['scripts/encode-meaning-taxonomy.mjs', flags[first], flags[second]], { cwd: root, encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${flags[first]} and ${flags[second]} must conflict.`);
      assert.match(result.stderr, /mutually exclusive/);
    }
  }
  const encoder = await readFile(resolve(root, 'scripts/encode-meaning-taxonomy.mjs'), 'utf8');
  assert.match(encoder, /policyV2 \? 'policy-v2'/);
  assert.match(encoder, /policyV2 \? 'scripts\/audit-meaning-policy-v2\.mjs'/);
  assert.match(encoder,
    /A photo illustrating \$\{row\.word\} \(\$\{row\.partOfSpeech \|\| 'word'\}\): \$\{row\.definition\}/);
  assert.doesNotMatch(encoder, /prompts\s*=\s*dataset\.items\.map\([^\n]*(?:labels|targets|anchorCategory)/);
});

test('old holdouts stay retired, paraphrases inherit parent groups and unit weights, fresh cohorts stay isolated', async () => {
  const [dataset, source] = await Promise.all([
    readJson('dataset.json'),
    readJson('../regularized-expansion/dataset.json')
  ]);
  const sourceById = new Map(source.items.map(row => [row.id, row]));
  const rowsById = new Map(dataset.items.map(row => [row.id, row]));
  const paraphrases = source.items.filter(row => row.kind === 'paraphrase');
  assert.equal(paraphrases.length, 140);
  const trainUnits = new Map();
  for (const row of dataset.items.filter(item => item.split === 'train')) {
    trainUnits.set(row.meaningUnitId, (trainUnits.get(row.meaningUnitId) || 0) + row.sampleWeight);
  }
  for (const original of source.items) {
    const revised = rowsById.get(original.id);
    assert(revised, `Missing old source row ${original.id}.`);
    if (original.split === 'train') assert(['train', 'quarantine'].includes(revised.split));
    else assert(['retired-validation', 'retired-test', 'quarantine'].includes(revised.split));
    if (original.kind === 'paraphrase') {
      const parent = rowsById.get(original.sourceId);
      assert(parent && sourceById.has(original.sourceId));
      assert.equal(revised.groupId, parent.groupId);
      assert.equal(revised.meaningUnitId, parent.meaningUnitId);
      assert.deepEqual(revised.labels, parent.labels);
    }
  }
  for (const [unit, weight] of trainUnits) assert(Math.abs(weight - 1) <= 1e-8, `${unit}: ${weight}`);

  for (const split of ['validation', 'test']) {
    const fresh = dataset.items.filter(row => row.split === split);
    assert.equal(fresh.length, split === 'validation' ? 60 : 120);
    assert(fresh.every(row => row.sourceRecord.file.endsWith('/policy-v2/new-annotations.json')
      && !row.relatedExistingId && !row.sourceId));
    for (const category of dataset.categories) {
      assert.equal(fresh.filter(row => row.anchorCategory === category).length, split === 'validation' ? 10 : 20);
    }
  }
});
