import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { sharedInferenceScope } from '../js/services/sharedInferenceScope.js';
import { handleModelCacheRequest } from '../js/services/modelCache.js';

async function fixture(context) {
  const originals = Object.fromEntries(['SharedWorker', 'Worker', 'BroadcastChannel', 'caches', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const registry = new Map(), channels = new Set(), created = [], connections = [];
  class Control {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) { for (const channel of [...channels]) if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.onmessage?.({ data })); }
    close() { channels.delete(this); }
  }
  globalThis.BroadcastChannel = Control;
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.Worker = class { constructor() { assert.fail('Shared inference must not create a dedicated model copy.'); } };
  globalThis.SharedWorker = class {
    constructor(url, options) {
      let model = registry.get(options.name);
      if (!model) {
        const scope = { BroadcastChannel: Control, close() { model.closed = true; registry.delete(options.name); } };
        const channel = sharedInferenceScope(scope, String(url).includes('meaning') ? 'meaning' : 'clip');
        model = { name: options.name, scope, channel, requests: [], closed: false };
        channel.onmessage = ({ data }) => model.requests.push(data);
        registry.set(options.name, model); created.push(model);
      }
      const { port1, port2 } = new MessageChannel();
      this.port = port1;
      model.scope.onconnect({ ports: [port2] });
    }
  };
  const id = crypto.randomUUID();
  const main = await import(`../js/services/inferenceWorker.js?main=${id}`);
  const quick = await import(`../js/services/inferenceWorker.js?quick=${id}`);
  const connect = (window, kind = 'clip', options) => {
    const connection = window.createInferenceWorker(kind, options);
    connections.push(connection); return connection;
  };
  const waitFor = async predicate => {
    for (let turn = 0; turn < 200; turn++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
    assert.ok(predicate(), 'Expected a shared-worker message.');
  };
  context.after(() => {
    for (const connection of connections) connection.terminate();
    for (const control of [...channels]) control.postMessage({ type: 'reset', kind: 'clip' });
    for (const control of [...channels]) control.postMessage({ type: 'reset', kind: 'meaning' });
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { main, quick, registry, created, connect, waitFor };
}

test('Main and Quick Add share one model per role and isolate colliding request IDs', async context => {
  const env = await fixture(context);
  const main = env.connect(env.main), quick = env.connect(env.quick);
  const mainMeaning = env.connect(env.main, 'meaning'), quickMeaning = env.connect(env.quick, 'meaning');
  const mainVision = env.connect(env.main, 'clip', { role: 'vision', slot: 1 });
  const quickVision = env.connect(env.quick, 'clip', { role: 'vision', slot: 1 });
  assert.equal(env.created.length, 3, 'six window connections share three loaded worker contexts');
  const received = [[], []]; main.onmessage = event => received[0].push(event.data); quick.onmessage = event => received[1].push(event.data);
  main.postMessage({ id: 1, type: 'texts', payload: { texts: ['main'] } });
  quick.postMessage({ id: 1, type: 'texts', payload: { texts: ['quick'] } });
  const model = env.created[0];
  await env.waitFor(() => model.requests.length === 2);
  assert.notEqual(model.requests[0].id, model.requests[1].id);
  for (const request of model.requests) model.channel.postMessage({ id: request.id, result: request.payload.texts });
  await env.waitFor(() => received.every(events => events.length === 1));
  assert.deepEqual(received, [[{ id: 1, result: ['main'] }], [{ id: 1, result: ['quick'] }]]);
  main.terminate(); mainMeaning.terminate(); mainVision.terminate();
  await new Promise(setImmediate);
  assert.ok(env.created.every(model => !model.closed), 'Quick Add keeps every shared model alive');
  quick.postMessage({ id: 2, type: 'texts', payload: { texts: ['still open'] } });
  await env.waitFor(() => model.requests.length === 3);
  model.channel.postMessage({ id: model.requests[2].id, result: 'ready' });
  await env.waitFor(() => received[1].length === 2);
  assert.equal(received[1][1].result, 'ready');
  quick.terminate(); quickMeaning.terminate(); quickVision.terminate();
  await env.waitFor(() => env.created.every(model => model.closed));
});

test('cancelling one window discards only its result and queued request', async context => {
  const env = await fixture(context), main = env.connect(env.main), quick = env.connect(env.quick);
  const received = [[], []]; main.onmessage = event => received[0].push(event.data); quick.onmessage = event => received[1].push(event.data);
  main.postMessage({ id: 7, type: 'image', payload: { blob: new Blob(['pixels'], { type: 'image/jpeg' }) } });
  quick.postMessage({ id: 7, type: 'image', payload: { blob: new Blob(['other pixels'], { type: 'image/jpeg' }) } });
  const model = env.created[0];
  await env.waitFor(() => model.requests.length === 2);
  const mainRequest = model.requests.find(request => request.payload.blob.size === 6), quickRequest = model.requests.find(request => request.payload.blob.size !== 6);
  main.postMessage({ type: 'cancel', id: 7 });
  await env.waitFor(() => model.requests.some(request => request.type === 'cancel'));
  model.channel.postMessage({ id: mainRequest.id, result: 'cancelled result' });
  model.channel.postMessage({ id: quickRequest.id, result: 'quick result' });
  await env.waitFor(() => received[1].length === 1);
  assert.deepEqual(received, [[], [{ id: 7, result: 'quick result' }]]);
});

test('model-cache loading moves to the remaining window when its first bridge closes', async context => {
  const env = await fixture(context), main = env.connect(env.main), quick = env.connect(env.quick);
  const first = [], second = [], replies = [];
  main.onmessage = ({ data }) => first.push(data);
  quick.onmessage = ({ data }) => second.push(data);
  const model = env.created[0];
  model.channel.addEventListener('message', ({ data }) => { if (data.type === 'model-cache-result') replies.push(data); });
  model.channel.postMessage({ type: 'model-cache', cache: 'keepvocab-clip-model-v3', cacheId: 1, operation: 'match', url: 'https://weights.test/model' });
  await env.waitFor(() => first.length === 1);
  main.terminate();
  await env.waitFor(() => second.length === 1);
  globalThis.caches = { open: async () => ({ match: async () => new Response('model bytes') }) };
  await handleModelCacheRequest(quick, second[0]);
  await env.waitFor(() => replies.length === 1);
  assert.equal(new TextDecoder().decode(replies[0].result.bytes), 'model bytes');
  assert.equal(first[0].sharedCacheToken, second[0].sharedCacheToken);
  assert.equal(model.closed, false);
});

test('explicit model removal invalidates every window for that model and permits a fresh instance', async context => {
  const env = await fixture(context), main = env.connect(env.main, 'meaning'), quick = env.connect(env.quick, 'meaning'), clip = env.connect(env.main);
  const errors = [];
  main.onerror = event => errors.push(event.message); quick.onerror = event => errors.push(event.message);
  env.main.resetInferenceWorkers('meaning');
  await env.waitFor(() => errors.length === 2);
  assert.ok(errors.every(message => /disabled or removed/.test(message)));
  assert.equal(env.created[0].closed, true);
  assert.equal(env.created[1].closed, false, 'image inference is unaffected');
  env.connect(env.quick, 'meaning');
  assert.equal(env.created.length, 3);
  clip.terminate();
});

test('immediate re-enabling uses a fresh shared generation before the old reset is delivered', async context => {
  const env = await fixture(context), old = env.connect(env.main);
  const oldErrors = []; old.onerror = event => oldErrors.push(event.message);
  env.main.resetInferenceWorkers('clip');
  const replacement = env.connect(env.quick), replies = [];
  replacement.onmessage = ({ data }) => replies.push(data);
  replacement.onerror = event => assert.fail(event.message);
  assert.equal(env.created.length, 2);
  replacement.postMessage({ id: 1, type: 'texts', payload: { texts: ['new request'] } });
  await env.waitFor(() => oldErrors.length && env.created[1].requests.length);
  env.created[1].channel.postMessage({ id: env.created[1].requests[0].id, result: 'ready' });
  await env.waitFor(() => replies.length === 1);
  assert.equal(replies[0].result, 'ready');
});
