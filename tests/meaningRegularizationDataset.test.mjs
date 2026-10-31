import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixture = resolve(root, 'tests/fixtures/meaning-taxonomy/regularized-expansion');

test('regularized meaning fixture passes its integrity audit', () => {
  const result = spawnSync(process.execPath, ['scripts/audit-meaning-regularization.mjs'], {
    cwd: root, encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.count, 1420);
  assert.equal(summary.newMeaningCount, 280);
  assert.equal(summary.paraphraseCount, 140);
});

test('regularized encoder selector rejects combinations with other fixture selectors', () => {
  for (const flag of ['--supplement', '--expanded']) {
    const result = spawnSync(process.execPath, ['scripts/encode-meaning-taxonomy.mjs', '--regularized', flag], {
      cwd: root, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0, `${flag} must not combine with --regularized.`);
    assert.match(result.stderr, /mutually exclusive/);
  }
});

test('paraphrases remain folded into their training parent with unit total weight', async () => {
  const dataset = JSON.parse(await readFile(resolve(fixture, 'dataset.json'), 'utf8'));
  const annotationsFile = JSON.parse(await readFile(resolve(fixture, 'new-annotations.json'), 'utf8'));
  const annotations = Array.isArray(annotationsFile) ? annotationsFile : annotationsFile.items;
  const byId = new Map(annotations.map(row => [row.id, row]));
  const sourceDataset = JSON.parse(await readFile(resolve(root, 'tests/fixtures/meaning-taxonomy/expanded-1000/dataset.json'), 'utf8'));
  const sourceById = new Map(sourceDataset.items.map(row => [row.id, row]));
  const old = new Map(dataset.items.filter(row => row.sourceRecord.file.endsWith('expanded-1000/dataset.json'))
    .map(row => [row.id, row]));
  const paraphrases = dataset.items.filter(row => row.kind === 'paraphrase');
  assert.equal(paraphrases.length, 140);
  const units = new Map();
  for (const row of dataset.items.filter(item => item.split === 'train')) {
    units.set(row.meaningUnitId, (units.get(row.meaningUnitId) || 0) + row.sampleWeight);
  }
  for (const row of paraphrases) {
    const annotation = byId.get(row.sourceRecord.id);
    const parentId = annotation.sourceId;
    const parent = old.get(parentId);
    assert(parent && parent.split === 'train', `Missing training parent for ${row.id}.`);
    assert.equal(row.meaningUnitId, parentId);
    assert.equal(row.groupId, parent.groupId);
    assert.equal(row.sourceGroupId, sourceById.get(parentId).groupId);
    assert.equal(row.split, 'train');
  }
  for (const [unit, weight] of units) assert(Math.abs(weight - 1) <= 1e-8, `${unit} total weight ${weight}`);
});
