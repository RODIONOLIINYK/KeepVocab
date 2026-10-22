import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('app upgrades keep separately downloaded model files and other origin caches', async () => {
  const handlers = {};
  const deleted = [];
  let activated;
  const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const current = source.match(/const CACHE_NAME = '([^']+)'/)[1];
  vm.runInNewContext(source, {
    self: { addEventListener: (type, callback) => { handlers[type] = callback; }, clients: { claim() {} } },
    caches: { keys: async () => ['keepvocab-v1', current, 'keepvocab-clip-model-v1', 'another-app'], delete: async key => deleted.push(key) }
  });
  handlers.activate({ waitUntil: promise => { activated = promise; } });
  await activated;
  assert.deepEqual(deleted, ['keepvocab-v1']);
});
