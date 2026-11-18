import { createInferenceTimings } from '../js/services/inferenceTimings.js';
import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers';
import { MEANING_MAX_TOKENS, MEANING_MODEL_TAG, MEANING_MODEL_BASE, MEANING_MODEL_REPO, MEANING_MODEL_REVISION, MEANING_CACHE } from '../js/ml/meaningConfig.js';
import { referenceEmbedding, referenceFeatures, referenceProbability } from '../js/services/meaningReferenceFeatures.js';
import { workerModelCache } from '../js/services/modelCache.js';
import { inferenceQueue, sharedInferenceScope } from '../js/services/sharedInferenceScope.js';

const timings = createInferenceTimings('meaning');
const channel = typeof self.postMessage === 'function' ? self : sharedInferenceScope(self, 'meaning');

const base = new URL(MEANING_MODEL_BASE);
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = base.origin;
env.remotePathTemplate = base.pathname.replace(/^\/+|\/+$/g, '');
// Settings owns model downloads. This worker loads only the installed reference
// and never fetches a substitute encoder or creates another profile cache.
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = workerModelCache(MEANING_CACHE, timings);
const originalFetch = env.fetch;
const runtimeUrls = new Set([
  new URL('./runtime/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
  new URL('./runtime/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href
]);
env.fetch = (input, options) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (runtimeUrls.has(url)) return originalFetch(input, options);
  throw new Error('Download the merge model in Settings first.');
};
env.useFSCache = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./runtime/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
  wasm: new URL('./runtime/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href
};
let loading;
async function initialize() {
  if (!loading) loading = timings.measure('initialize', async () => {
    const options = { revision: MEANING_MODEL_REVISION };
    const tokenizer = await AutoTokenizer.from_pretrained(MEANING_MODEL_REPO, options);
    const response = await env.customCache.match(new URL('scorer.json', base).href);
    if (!response?.ok) throw new Error('Download the merge model in Settings first.');
    const scorer = await response.json();
    const model = await AutoModel.from_pretrained(MEANING_MODEL_REPO, { ...options, dtype: 'fp16', device: 'wasm' });
    return { tokenizer, model, scorer };
  }).catch(error => { loading = null; throw error; });
  return loading;
}
const memory = new Map();
async function run({ type, texts, pairs }, current) {
  const { tokenizer, model, scorer } = await initialize();
  if (!current()) return;
  if (type === 'initialize') return { model: MEANING_MODEL_TAG };
  if (!Array.isArray(texts) || texts.length > 24 || texts.some(text => typeof text !== 'string' || text.length > 4000)
    || !Array.isArray(pairs) || pairs.length > 276 || pairs.some(p => !Array.isArray(p) || p.length !== 2 || p.some(i => !Number.isInteger(i) || i < 0 || i >= texts.length))) throw new Error('Invalid meaning comparison.');
  const missing = [...new Set(texts.filter(text => !memory.has(text)))];
  for (const text of texts) if (memory.has(text)) {
    const value = memory.get(text); memory.delete(text); memory.set(text, value);
  }
  for (let start = 0; start < missing.length; start += 8) {
    if (!current()) return;
    const batch = missing.slice(start, start + 8);
    const inputs = tokenizer(batch, { padding: 'max_length', max_length: MEANING_MAX_TOKENS, truncation: true });
    let output;
    try {
      output = await timings.measure('meaning-forward', () => model(inputs), { batch: batch.length });
      if (!current()) return;
      const hidden = output.last_hidden_state.tolist();
      const ids = inputs.input_ids.tolist().map(row => row.map(Number));
      const masks = inputs.attention_mask.tolist().map(row => row.map(Number));
      const special = new Set(tokenizer.all_special_ids.map(Number));
      const colon = tokenizer.convert_tokens_to_ids(':');
      batch.forEach((text, i) => memory.set(text, referenceEmbedding(hidden[i], ids[i], masks[i], special, colon)));
      while (memory.size > 192) memory.delete(memory.keys().next().value);
    } finally {
      for (const tensor of [...Object.values(inputs), ...Object.values(output || {})]) tensor?.dispose?.();
    }
  }
  return { model: MEANING_MODEL_TAG, scores: pairs.map(([a, b]) => referenceProbability(referenceFeatures(memory.get(texts[a]), memory.get(texts[b]), scorer), scorer)) };
}
channel.onmessage = inferenceQueue(channel, run, timings);
