import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { modelStorageOperation, handleModelStorageRequest } from '../desktop/modelStorage.cjs';
import { modelCacheStorage, handleModelCacheRequest, readModelResponse } from '../js/services/modelCache.js';

test('native model cache migrates profile files, writes complete chunked files and removes its owned directory', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'keepvocab-model-storage-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const prior = globalThis.keepVocabDesktop, oldCaches = globalThis.caches, oldFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => handleModelStorageRequest(root, new Request(new URL(url, 'http://127.0.0.1:8085'), options));
  context.after(() => { globalThis.keepVocabDesktop = prior; globalThis.caches = oldCaches; globalThis.fetch = oldFetch; });
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
test('native binary routes reject partial, invalid, missing and removed files', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'keepvocab-binary-model-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  const cache = 'keepvocab-clip-model-v3', key = 'a'.repeat(64), token = 'b'.repeat(24);
  const invoke = args => modelStorageOperation(root, { cache, key, token, ...args });
  const request = (suffix = `${cache}/${key}`, method = 'GET') => handleModelStorageRequest(root, new Request(`http://127.0.0.1:8085/_keepvocab_models/${suffix}`, { method }));
  await invoke({ action: 'write', offset: 0, data: Buffer.from('weights').toString('base64') });
  assert.equal((await request()).status, 404);
  await invoke({ action: 'commit', size: 7, url: 'https://models.test/model', headers: [['content-type', 'model/test']] });
  assert.equal(await (await request()).text(), 'weights');
  assert.equal((await request(undefined, 'HEAD')).headers.get('content-length'), '7');
  assert.equal((await request(undefined, 'POST')).status, 405);
  for (const suffix of ['../escape', `${cache}/${key}.json`, `${cache}/${key}.${token}.part`, `${cache}/wrong`]) assert.equal((await request(suffix)).status, 404);
  const info = await invoke({ action: 'stat' });
  assert.equal(info.readUrl, `/_keepvocab_models/${cache}/${key}`);
  await invoke({ action: 'delete' });
  assert.equal((await request()).status, 404);
});

test('binary read rejects errors, truncated or oversized responses and preserves metadata', async context => {
  const prior = globalThis.fetch; context.after(() => { globalThis.fetch = prior; });
  const info = { readUrl: '/_keepvocab_models/committed', size: 7, headers: [['content-type', 'model/test']] };
  for (const body of ['short', 'too many bytes']) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects((await readModelResponse(info)).arrayBuffer(), /stored model/i);
  }
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(readModelResponse(info), /could not be read/);
  globalThis.fetch = async (_url, options) => { assert.equal(options.cache, 'no-store'); return new Response('weights'); };
  const response = await readModelResponse(info);
  assert.equal(response.headers.get('content-type'), 'model/test');
  assert.equal(await response.text(), 'weights');
});

test('native worker cache sends a small descriptor, browser cache transfers its owned buffer', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'keepvocab-cache-descriptor-'));
  const prior = globalThis.keepVocabDesktop, oldCaches = globalThis.caches;
  context.after(async () => { globalThis.keepVocabDesktop = prior; globalThis.caches = oldCaches; await rm(root, { force: true, recursive: true }); });
  const calls = [];
  globalThis.caches = undefined;
  globalThis.keepVocabDesktop = { modelStorage: args => { calls.push(args.action); return modelStorageOperation(root, args); } };
  const cache = 'keepvocab-clip-model-v3', url = 'https://models.test/descriptor';
  await (await modelCacheStorage().open(cache)).put(url, new Response('weights'));
  calls.length = 0;
  const replies = [], worker = { postMessage: (data, transfer) => replies.push({ data, transfer }) };
  const request = { type: 'model-cache', cache, cacheId: 7, operation: 'match', url, sharedCacheToken: 42 };
  await handleModelCacheRequest(worker, request);
  assert.equal(replies[0].data.sharedCacheToken, 42);
  assert.equal(replies[0].data.result.size, 7);
  assert.equal(replies[0].data.result.bytes, undefined);
  assert.deepEqual(replies[0].transfer, []);
  assert.deepEqual(calls, ['stat']);
  globalThis.keepVocabDesktop = undefined;
  globalThis.caches = { open: async () => ({ match: async () => new Response('browser weights') }) };
  await handleModelCacheRequest(worker, request);
  assert.equal(replies[1].transfer[0], replies[1].data.result.bytes);
});

test('native cache streams bounded chunks and aborts a failed write without publishing it', async t => {
  const previous = globalThis.keepVocabDesktop;
  t.after(() => { globalThis.keepVocabDesktop = previous; });
  const operations = [];
  globalThis.keepVocabDesktop = { modelStorage: async request => {
    operations.push(request.action);
    if (request.action === 'write' && request.offset) throw new Error('Storage full');
  } };
  const cache = await modelCacheStorage().open('keepvocab-clip-model-v3');
  const response = new Response(new Uint8Array(2 * 1024 * 1024 + 5));
  response.arrayBuffer = () => assert.fail('Native writes must stream the input');
  await assert.rejects(cache.put('https://models.test/large', response), /Storage full/);
  assert.deepEqual(operations, ['write', 'write', 'abort']);
});
