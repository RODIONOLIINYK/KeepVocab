import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function offlineWorker(entries = new Map()) {
  const listeners = new Map();
  const lookups = [];
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://keepvocab.test' }, addEventListener: (type, callback) => listeners.set(type, callback) },
    URL, Response,
    fetch: async () => { throw new Error('offline'); },
    caches: { match: async (request, options) => {
      const key = typeof request === 'string' ? request : request.url;
      lookups.push(key);
      const path = options?.ignoreSearch ? new URL(key).pathname : key;
      return entries.get(path);
    } }
  });
  return {
    lookups,
    request(path, mode = 'cors') {
      let response;
      listeners.get('fetch')({
        request: { url: `https://keepvocab.test${path}`, method: 'GET', mode },
        respondWith(value) { response = value; }
      });
      return response;
    }
  };
}

test('offline document navigation falls back to the cached app shell', async () => {
  const shell = new Response('<!doctype html><title>KeepVocab</title>', { headers: { 'Content-Type': 'text/html' } });
  const worker = offlineWorker(new Map([['./index.html', shell]]));
  assert.equal(await worker.request('/unknown-route', 'navigate'), shell);
});

test('offline assets use their matching cache entry despite a version query', async () => {
  const module = new Response('export const ready = true;', { headers: { 'Content-Type': 'text/javascript' } });
  const worker = offlineWorker(new Map([['/js/ready.js', module]]));
  assert.equal(await worker.request('/js/ready.js?v=42'), module);
  assert.deepEqual(worker.lookups, ['https://keepvocab.test/js/ready.js?v=42']);
});

test('uncached offline JavaScript, JSON and images fail without receiving app HTML', async () => {
  const shell = new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  const worker = offlineWorker(new Map([['./index.html', shell]]));
  for (const path of ['/js/missing.js', '/missing.json', '/missing.png']) {
    const response = await worker.request(path);
    assert.equal(response.type, 'error', path);
    assert.equal(response.status, 0, path);
    assert.equal(await response.text(), '', path);
  }
  assert.equal(worker.lookups.includes('./index.html'), false);
});

test('offline navigation without a cached shell produces a network error', async () => {
  const worker = offlineWorker();
  assert.equal((await worker.request('/unknown-route', 'navigate')).type, 'error');
});
