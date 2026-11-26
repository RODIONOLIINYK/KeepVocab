import { inferenceQueue } from '../js/services/sharedInferenceScope.js';
import { createInferenceTimings } from '../js/services/inferenceTimings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as config from '../js/ml/meaningConfig.js';
import { referenceEmbedding, referenceFeatures, referenceProbability } from '../js/services/meaningReferenceFeatures.js';

async function createWorkerFixture() {
  const source = (await readFile(new URL('../scripts/meaning-worker.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  const scorer = JSON.parse(await readFile(new URL('scorer.json', config.MEANING_MODEL_BASE)));
  const calls = [], cacheRequests = [];
  let batchSize = 0;
  const tokenizer = batch => {
    batchSize = batch.length;
    return { input_ids: { tolist: () => batch.map(() => [1, 2]) }, attention_mask: { tolist: () => batch.map(() => [1, 1]) } };
  };
  tokenizer.all_special_ids = [];
  tokenizer.convert_tokens_to_ids = () => 99;
  const scope = { location: { href: 'https://localhost/js/ml/meaningWorker.bundle.js' }, postMessage() {} };
  const context = vm.createContext({inferenceQueue, createInferenceTimings, ...config, MEANING_MODEL_BASE: 'https://localhost/models/meaning-minilm-v8/',
    self: scope, env: { fetch: () => { throw new Error('Unexpected network request'); }, backends: { onnx: { wasm: {} } } },
    referenceEmbedding, referenceFeatures, referenceProbability, URL, Map, Set, Promise,
    workerModelCache: cache => {
      assert.equal(cache, config.MEANING_CACHE);
      return { match: async url => { cacheRequests.push(url); return { ok: true, json: async () => scorer }; } };
    },
    AutoTokenizer: { from_pretrained: async model => { calls.push(model); return tokenizer; } },
    AutoModel: { from_pretrained: async (model, options) => {
      calls.push(model);
      assert.equal(options.dtype, 'fp16'); assert.equal(options.device, 'wasm');
      return async () => ({ last_hidden_state: { tolist: () => Array.from({ length: batchSize }, () => [[1, 0], [1, 0]]) } });
    } }
  });
  vm.runInContext(source, context);
  return { calls, cacheRequests, scorer, send: data => new Promise(resolve => { scope.postMessage = resolve; scope.onmessage({ data }); }) };
}

test('production v8 worker scores seven features with original full comparison texts and the local asset cache', async () => {
  const worker = await createWorkerFixture();
  const message = { id: 1, type: 'compare', texts: ['i̇stanbul', 'word '.repeat(120)],
    comparisonTexts: ['İstanbul', 'word '.repeat(120)], pairs: [[0, 1], [1, 0]] };
  const response = await worker.send(message);
  assert.equal(response.error, undefined);
  assert.equal(response.result.model, config.MEANING_MODEL_TAG);
  const encoded = { pooled: [1, 0], ids: [1, 2], tokens: [[1, 0], [1, 0]] };
  const expected = referenceProbability(referenceFeatures(encoded, encoded, worker.scorer, ...message.comparisonTexts), worker.scorer);
  assert.deepEqual(Array.from(response.result.scores), [expected, expected]);
  assert.deepEqual(worker.calls, [config.MEANING_MODEL_ID, config.MEANING_MODEL_ID]);
  assert.deepEqual(worker.cacheRequests, ['https://localhost/models/meaning-minilm-v8/scorer.json']);
  assert.equal((await worker.send({ ...message, id: 2 })).result.scores[0], expected);
  assert.equal(worker.calls.length, 2);
});

test('production v8 worker rejects requests that omit untruncated comparison texts', async () => {
  const worker = await createWorkerFixture();
  const response = await worker.send({ id: 1, type: 'compare', texts: ['one', 'two'], pairs: [[0, 1]] });
  assert.equal(response.result, undefined);
  assert.match(response.error, /Invalid meaning comparison/);
});
