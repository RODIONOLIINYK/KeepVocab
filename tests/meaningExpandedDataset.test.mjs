import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);

test('expanded 1000-meaning dataset has verified sources, reviews, and leakage-safe partitions', () => {
  const result = spawnSync(process.execPath, [new URL('scripts/audit-meaning-expanded.mjs', root).pathname], {
    cwd: new URL('.', root).pathname,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.count, 1000);
  assert.equal(summary.legacyRows, 469);
  assert.equal(summary.newlyReviewedRows, 531);
  assert.equal(summary.quarantinedSourceIds, 5);
});

test('meaning encoder rejects simultaneous supplement and expanded dataset modes', () => {
  const result = spawnSync(process.execPath, [new URL('scripts/encode-meaning-taxonomy.mjs', root).pathname,
    '--supplement', '--expanded'], { cwd: new URL('.', root).pathname, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mutually exclusive/);
});
