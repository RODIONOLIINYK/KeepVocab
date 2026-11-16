import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { modelStorageOperation } from '../desktop/modelStorage.cjs';
import { modelCacheStorage } from '../js/services/modelCache.js';

test('native model cache migrates profile files, writes complete chunked files and removes its owned directory', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'keepvocab-model-storage-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const prior = globalThis.keepVocabDesktop, oldCaches = globalThis.caches;
  context.after(() => { globalThis.keepVocabDesktop = prior; globalThis.caches = oldCaches; });
  const legacy = new Map([['https://models.test/old', new Response('existing weights')]]);
  globalThis.caches = { keys: async () => ['keepvocab-clip-model-v3'], open: async () => ({
    match: async url => legacy.get(url)?.clone(), delete: async url => legacy.delete(url), keys: async () => [...legacy.keys()]
  }), delete: async () => {} };
  globalThis.keepVocabDesktop = { modelStorage: args => modelStorageOperation(root, args) };
  const cache = await modelCacheStorage().open('keepvocab-clip-model-v3');
  assert.equal(await cache.has('https://models.test/old'), true);
  assert.equal(legacy.size, 0, 'successful migration removes the browser copy');
  assert.equal(await (await cache.match('https://models.test/old')).text(), 'existing weights');
  const bytes = new Uint8Array(2 * 1024 * 1024 + 33).fill(42);
  await cache.put('https://models.test/new', new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
  assert.deepEqual(new Uint8Array(await (await cache.match('https://models.test/new')).arrayBuffer()), bytes);
  assert.equal((await readdir(path.join(root, 'keepvocab-clip-model-v3'))).some(name => name.endsWith('.part')), false);
  await modelCacheStorage().delete('keepvocab-clip-model-v3');
  assert.deepEqual(await readdir(root), []);
});
test('native model storage rejects traversal and never exposes incomplete files', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'keepvocab-model-storage-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const args = { cache: 'keepvocab-meaning-model-v1', key: 'a'.repeat(64), token: 'b'.repeat(24) };
  await assert.rejects(modelStorageOperation(root, { ...args, action: 'write', cache: '../escape' }), /Invalid model cache/);
  await assert.rejects(modelStorageOperation(root, { ...args, action: 'write', key: '../escape' }), /Invalid model file key/);
  await modelStorageOperation(root, { ...args, action: 'write', offset: 0, data: Buffer.from('partial').toString('base64') });
  assert.deepEqual(await modelStorageOperation(root, { ...args, action: 'stat' }), {});
  await assert.rejects(modelStorageOperation(root, { ...args, action: 'commit', size: 100 }), /Incomplete/);
  await modelStorageOperation(root, { ...args, action: 'abort' });
});
