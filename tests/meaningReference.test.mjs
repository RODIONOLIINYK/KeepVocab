import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { referenceEmbedding, referenceFeatures, referenceLengthFeatures, referenceProbability } from '../js/services/meaningReferenceFeatures.js';
import { groupEntrySensesLocally } from '../js/services/localSenseGrouping.js';
import { meaningPairKey } from '../js/services/meaningEquivalenceLearning.js';
import { MemoryStorage } from '../js/services/driveSync.js?v=18908';
import { MEANING_MODEL_ID, MEANING_MODEL_TAG, MEANING_MODEL_BASE, MEANING_MODEL_SHA256, MEANING_SCORER_SHA256,
  MEANING_MERGE_THRESHOLD, MEANING_REVIEW_THRESHOLD, MEANING_CACHE } from '../js/ml/meaningConfig.js';
import { MEANING_MODEL_ASSETS } from '../js/ml/meaningAssets.js';

test('reference pooling retains context while token matching masks the first-colon prefix, specials and padding', () => {
  const encoded = referenceEmbedding([[1, 0], [0, 1], [1, 1], [3, 0], [0, 2], [8, 8]], [101, 8, 9, 10, 102, 0], [1, 1, 1, 1, 1, 0], new Set([0, 101, 102]), 9);
  assert.deepEqual(encoded.ids, [10]);
  assert.deepEqual(encoded.tokens, [[1, 0]]);
  assert.ok(Math.abs(encoded.pooled[0] - 5 / Math.sqrt(41)) < 1e-12);
  const fallback = referenceEmbedding([[0, 1], [1, 0]], [10, 9], [1, 1], new Set(), 9);
  assert.deepEqual(fallback.ids, [10, 9]);
});
test('five features are symmetric; IDF changes only the mean and quantiles interpolate', () => {
  const a = { pooled: [1, 0], ids: [1, 2, 3], tokens: [[1, 0], [0, 1], [-1, 0]] };
  const b = { pooled: [1, 0], ids: [4], tokens: [[1, 0]] };
  const scorer = { idfLookup: { 1: 3, 2: 1 }, defaultIdf: 2, weights: [1, 2, 3, 4, 5], bias: -2 };
  const features = referenceFeatures(a, b, scorer);
  assert.deepEqual(features, referenceFeatures(b, a, scorer));
  assert.deepEqual(features, [1, (1 / 6 + 1) / 2, 0, .25, 1 / 3]);
  const other = referenceFeatures(a, b, { ...scorer, idfLookup: {}, defaultIdf: 1 });
  assert.notEqual(other[1], features[1]);
  assert.deepEqual(other.filter((_, i) => i !== 1), features.filter((_, i) => i !== 1));
  assert.ok(referenceProbability(features, scorer) > 0 && referenceProbability(features, scorer) < 1);
});
const senses = [
  { id: 'a', word: 'begin', partOfSpeech: 'verb', definition: 'To commence.' },
  { id: 'b', word: 'begin', partOfSpeech: 'verb', definition: 'To start doing something.' },
  { id: 'c', word: 'begin', partOfSpeech: 'verb', definition: 'To stop doing something.' }
];
test('v8 Min/MaxLen uses symmetric full-gloss word counts and training-only float32 scaling', () => {
  const scaler = { mean: [1.961212396621704, 2.4570188522338867], std: [.45669472217559814, .4575444161891937] };
  const short = "can't well-known l’esprit café_2 ⅓", long = 'word '.repeat(140);
  const expected = [5, 140].map((count, index) =>
    Math.fround(Math.fround(Math.fround(Math.log1p(count)) - scaler.mean[index]) / scaler.std[index]));
  assert.deepEqual(referenceLengthFeatures(short, long, scaler), expected);
  assert.deepEqual(referenceLengthFeatures(long, short, scaler), expected);
  assert.deepEqual(referenceLengthFeatures('', '', { mean: [0, 0], std: [1, 1] }), [0, 0]);
  assert.deepEqual(referenceLengthFeatures('İstanbul', 'İstanbul', { mean: [0, 0], std: [1, 1] }), [Math.fround(Math.log1p(1)), Math.fround(Math.log1p(1))]);
  assert.throws(() => referenceLengthFeatures(undefined, short, scaler), /Full meaning texts/);
  assert.throws(() => referenceLengthFeatures(short, long, { mean: [0, 0], std: [0, 1] }), /scaler/);
});
test('v8 scorer consumes all seven features, including tokenless fallback, and rejects incomplete vectors', () => {
  const encoded = { pooled: [1, 0], ids: [1], tokens: [[1, 0]] };
  const scorer = { variant: 'plus_log_min_max_words', weights: [0, 0, 0, 0, 0, 1, 1], bias: 0,
    idfLookup: {}, defaultIdf: 1, lengthScaler: { mean: [0, 0], std: [1, 1] } };
  const features = referenceFeatures(encoded, encoded, scorer, 'one', 'one two');
  assert.equal(features.length, 7);
  assert.deepEqual(features.slice(0, 5), [1, 1, 1, 1, 1]);
  assert.ok(Math.abs(referenceProbability(features, scorer) - 6 / 7) < 1e-7);
  assert.deepEqual(referenceFeatures({ ...encoded, ids: [], tokens: [] }, encoded, scorer, 'one', 'one two'), features);
  assert.throws(() => referenceFeatures(encoded, encoded, scorer), /Full meaning texts/);
  assert.throws(() => referenceProbability(features.slice(0, 5), scorer), /feature vector/);
});
test('local v8 encoder, scorer and tokenizer match their pinned asset hashes and invalidate v7 caches', async () => {
  assert.equal(MEANING_MODEL_ID, 'minilm-l6-v8-prefix-idf-bs16-minmax');
  assert.equal(MEANING_MODEL_ASSETS['onnx/model_fp16.onnx'].sha256, MEANING_MODEL_SHA256);
  assert.equal(MEANING_MODEL_ASSETS['scorer.json'].sha256, MEANING_SCORER_SHA256);
  assert.ok(MEANING_MODEL_TAG.includes(MEANING_SCORER_SHA256));
  assert.ok(MEANING_CACHE.includes(MEANING_SCORER_SHA256.slice(0, 12)));
  assert.match(MEANING_CACHE, /^keepvocab-[a-z0-9-]{1,70}$/);
  assert.ok(MEANING_REVIEW_THRESHOLD <= MEANING_MERGE_THRESHOLD);
  for (const [filename, asset] of Object.entries(MEANING_MODEL_ASSETS)) {
    const bytes = await readFile(new URL(filename, MEANING_MODEL_BASE));
    assert.equal(bytes.length, asset.bytes, filename);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, filename);
  }
  const scorer = JSON.parse(await readFile(new URL('scorer.json', MEANING_MODEL_BASE)));
  assert.equal(scorer.variant, 'plus_log_min_max_words');
  assert.equal(scorer.weights.length, 7);
  assert.equal(scorer.lengthScaler.mean.length, 2);
  const build = await readFile(new URL('../scripts/build-web.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes("'models/meaning-minilm-v8'"));
});
test('v8 grouping uses the validation best-F1 boundary and retains every merged score for review', async () => {
  for (const [probability, expectedCount] of [[MEANING_MERGE_THRESHOLD - 1e-8, 2], [MEANING_MERGE_THRESHOLD, 1], [.49, 1]]) {
    const result = await groupEntrySensesLocally({ word: 'begin', senses: senses.slice(0, 2) }, {
      storage: null, meaningLearningState: { records: [] }, scoreMeaningPairs: async () => [probability]
    });
    assert.equal(result.senses.length, expectedCount);
    if (expectedCount === 1) assert.equal(result.meaningReviewScores.length, 1);
  }
});
test('reference inference uses its threshold, complete linkage, user overrides and model-specific cached scores', async () => {
  const storage = new MemoryStorage(), entry = { word: 'begin', senses };
  let calls = 0;
  const scoreMeaningPairs = async (_senses, pairs) => { calls++; assert.deepEqual(pairs, [[0, 1], [0, 2], [1, 2]]); return [.999, .2, .999]; };
  const options = { storage, scoreMeaningPairs, meaningLearningState: { records: [] } };
  const result = await groupEntrySensesLocally(entry, options);
  assert.equal(result.senses.length, 2, 'complete linkage must reject the low A-C score');
  assert.equal(result.meaningEquivalenceModel, MEANING_MODEL_TAG);
  assert.equal(result.meaningInference.comparedPairs, 3);
  assert.equal(result.meaningInference.scorer, 'reference-minilm');
  assert.equal((await groupEntrySensesLocally(entry, options)).meaningInference.local, 'cached');
  assert.equal(calls, 1);
  const key = meaningPairKey('begin', 'verb', senses[0].definition, senses[1].definition);
  const override = await groupEntrySensesLocally(result, { ...options, reuseSemanticScoresOnly: true, meaningLearningState: { records: [{ source: 'user', key, label: 0 }] } });
  assert.ok(!override.senses.some(s => s.groupedSenses.some(x => x.id === 'a') && s.groupedSenses.some(x => x.id === 'b')));
  const stale = await groupEntrySensesLocally({ ...result, meaningEquivalenceModel: 'legacy-siglip' }, { ...options, reuseSemanticScoresOnly: true });
  assert.equal(stale.senses.length, 3, 'legacy scores cannot cause new-model merges');
});
test('reference unavailable, cancelled or invalid scores never produce statistical merges', async () => {
  for (const scoreMeaningPairs of [async () => { throw new Error('not installed'); }, async () => [NaN], async () => [1.1]]) {
    const result = await groupEntrySensesLocally({ word: 'begin', senses: senses.slice(0, 2) }, { storage: null, meaningLearningState: { records: [] }, scoreMeaningPairs });
    assert.equal(result.senses.length, 2);
    assert.equal(result.meaningInference.comparedPairs, 0);
  }
  const result = await groupEntrySensesLocally({ word: 'begin', senses: senses.slice(0, 2) }, { storage: null, meaningLearningState: { records: [] }, scoreMeaningPairs: async () => [MEANING_MERGE_THRESHOLD - 1e-8] });
  assert.equal(result.senses.length, 2);
  assert.equal(result.meaningReviewScores.length, 0);
});

test('a Different meanings judgment keeps near-duplicate twins cleanly separated across high model scores', async () => {
  const calmSenses = [
    { id: 'a', word: 'calm', partOfSpeech: 'verb', definition: 'To make calm.' },
    { id: 'b', word: 'calm', partOfSpeech: 'verb', definition: 'To become calm.' },
    { id: 'c', word: 'calm', partOfSpeech: 'verb', definition: '(transitive) To make calm.' },
    { id: 'd', word: 'calm', partOfSpeech: 'verb', definition: '(intransitive) To become calm.' }
  ];
  const key = meaningPairKey('calm', 'verb', calmSenses[0].definition, calmSenses[1].definition);
  const result = await groupEntrySensesLocally({ word: 'calm', senses: calmSenses }, {
    storage: null,
    meaningLearningState: {
      records: [{
        source: 'user',
        label: 0,
        key,
        word: 'calm',
        partOfSpeech: 'verb',
        definitionA: calmSenses[0].definition,
        definitionB: calmSenses[1].definition
      }]
    },
    scoreMeaningPairs: async (_senses, pairs) => pairs.map(() => 0.999)
  });
  assert.equal(result.senses.length, 2);
  assert.deepEqual(result.senses[0].groupedSenses.map(s => s.id), ['a', 'c']);
  assert.deepEqual(result.senses[1].groupedSenses.map(s => s.id), ['b', 'd']);
});

test('an uninstalled merge model reports unavailable instead of failed even when Web Workers exist', async context => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = class {};
  context.after(() => {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete globalThis.Worker;
  });
  const result = await groupEntrySensesLocally({ word: 'begin', senses: senses.slice(0, 2) }, {
    storage: null,
    meaningLearningState: { records: [] },
    scoreMeaningPairs: async () => {
      const error = new Error('Download the merge model in Settings to compare meanings locally.');
      error.code = 'NOT_INSTALLED';
      throw error;
    }
  });
  assert.equal(result.senses.length, 2);
  assert.equal(result.meaningInference.local, 'unavailable');
});

test('merge model download requires an explicit action, verifies bytes, reuses the install and clears it on removal', async context => {
  const descriptors = Object.fromEntries(['fetch', 'Worker', 'caches'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const assets = { ...MEANING_MODEL_ASSETS }, bytes = new TextEncoder().encode('download integrity fixture');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  for (const key of Object.keys(MEANING_MODEL_ASSETS)) delete MEANING_MODEL_ASSETS[key];
  MEANING_MODEL_ASSETS['config.json'] = { bytes: bytes.length, sha256: hash };
  const files = new Map(), requests = []; let fetches = 0, workers = 0, terminated = 0, corrupt = true;
  globalThis.fetch = async () => { fetches++; return new Response(corrupt ? 'corrupt' : bytes); };
  globalThis.caches = { open: async () => ({ match: async url => files.get(url)?.clone(), put: async (url, response) => { files.set(url, response.clone()); } }), delete: async () => { files.clear(); } };
  globalThis.Worker = class {
    constructor() { workers++; }
    postMessage(data) {
      requests.push(data);
      queueMicrotask(() => this.onmessage({ data: { id: data.id, result: { model: MEANING_MODEL_TAG,
        ...(data.type === 'compare' ? { scores: data.pairs.map(() => .7) } : {}) } } }));
    }
    terminate() { terminated++; }
  };
  const service = await import('../js/services/meaningReference.js?download-lifecycle-test');
  context.after(async () => {
    await service.removeMeaningModel();
    for (const key of Object.keys(MEANING_MODEL_ASSETS)) delete MEANING_MODEL_ASSETS[key];
    Object.assign(MEANING_MODEL_ASSETS, assets);
    for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  assert.equal(await service.preloadMeaningModel(), null);
  assert.equal(fetches, 0); assert.equal(workers, 0);
  await assert.rejects(service.downloadMeaningModel(), /checksum/);
  assert.equal(files.size, 0);
  assert.equal(service.getMeaningModelStatus().phase, 'error');
  corrupt = false;
  await service.downloadMeaningModel();
  assert.equal(service.getMeaningModelStatus().ready, true);
  assert.equal(fetches, 2); assert.equal(workers, 1);
  await service.downloadMeaningModel();
  assert.equal(fetches, 2, 'an installed model is not downloaded again');
  await service.scoreReferenceMeaningPairs([{ sourceDefinition: '(countable) İstanbul.', definition: 'Ignored display text.' },
    { definition: 'One two.' }], [[0, 1]]);
  assert.deepEqual(requests.at(-1).comparisonTexts, ['İstanbul.', 'One two.']);
  assert.deepEqual(requests.at(-1).texts, ['i̇stanbul.', 'one two.']);
  await service.removeMeaningModel();
  assert.equal(files.size, 0); assert.equal(terminated, 1);
  assert.equal(await service.preloadMeaningModel(), null);
  assert.equal(fetches, 2); assert.equal(workers, 1);
});

test('reference grouping scores beyond 24 senses, propagates scores to near-duplicate twins, picks one merged definition, and avoids stripped raw duplicates', async () => {
  const { consolidateEntrySenses } = await import('../js/services/localSenseGrouping.js');
  assert.equal(MEANING_MERGE_THRESHOLD, 0.42793698608875275);
  const raw = [
    { id: 'r0', word: 'make', partOfSpeech: 'verb', definition: '(transitive) To create.' },
    { id: 'r1', word: 'make', partOfSpeech: 'verb', definition: 'To build, construct, produce, or originate.' },
    ...Array.from({ length: 26 }, (_, i) => ({ id: `n${i}`, word: 'make', partOfSpeech: 'noun', definition: `Noun sense number ${i}.` })),
    { id: 'r28', word: 'make', partOfSpeech: 'verb', definition: '(intransitive) To create.' },
    { id: 'r29', word: 'make', partOfSpeech: 'verb', definition: 'To form or manufacture.' }
  ];
  const stripped = { id: 'sense-0', word: 'make', partOfSpeech: 'verb', definition: 'To create.', sourceDefinition: 'To create.' };
  const result = await consolidateEntrySenses({ word: 'make', rawDictionarySenses: raw, senses: [stripped] }, {
    storage: new MemoryStorage(),
    meaningLearningState: { records: [] },
    scoreMeaningPairs: async (batchSenses, pairs) => {
      assert.ok(batchSenses.length <= 24 && pairs.length <= 276, 'each RPC batch stays within worker limits');
      return pairs.map(([a, b]) => {
        const isCreate = s => /To create\.|To build|To form/.test(s.definition);
        return isCreate(batchSenses[a]) && isCreate(batchSenses[b]) ? 0.905 : 0.1;
      });
    }
  });
  assert.equal(result.senseConsolidation.originalCount, raw.length, 'stripped duplicate is not re-added');
  assert.equal(result.meaningInference.local, 'ready');
  const createCluster = result.senses.find(s => s.groupedSenses.some(g => g.id === 'r0'));
  assert.deepEqual(createCluster.groupedSenses.map(g => g.id).sort(), ['r0', 'r1', 'r28', 'r29']);
  assert.ok(createCluster.groupedSenses.some(g => g.definition === createCluster.definition),
    'merged group definition must be chosen from one of the merged meanings');
  assert.equal(createCluster.sourceDefinitions.length, 4);
});

test('driveSync.unmergeWordMeanings splits a saved merged card into separate meanings while preserving primary stats', async () => {
  const { DriveSyncService } = await import('../js/services/driveSync.js');
  const service = new DriveSyncService(new MemoryStorage());
  const saved = service.addWord({
    word: 'work',
    partOfSpeech: 'noun',
    definition: 'Employment.',
    sourceDefinition: 'Employment.',
    box: 3,
    groupedSenses: [
      { id: 'w1', word: 'work', partOfSpeech: 'noun', definition: 'Employment.', sourceDefinition: 'Employment.' },
      { id: 'w2', word: 'work', partOfSpeech: 'noun', definition: 'Labour, occupation, job.', sourceDefinition: 'Labour, occupation, job.', sourceUrl: 'https://dictionary.test/work', attribution: 'Dictionary source', example: 'Looking for work.' }
    ]
  }, 'November 2026 Vocabulary');
  const split = service.unmergeWordMeanings(saved.id);
  assert.equal(split.length, 2);
  assert.equal(service.getAllWords().length, 2);
  const primary = service.getAllWords().find(w => w.id === saved.id);
  const secondary = service.getAllWords().find(w => w.id !== saved.id);
  assert.equal(primary.definition, 'Employment.');
  assert.equal(primary.box, 3);
  assert.deepEqual(primary.groupedSenses, []);
  assert.equal(secondary.definition, 'Labour, occupation, job.');
  assert.equal(secondary.example, 'Looking for work.');
  assert.equal(secondary.sourceUrl, 'https://dictionary.test/work');
  assert.equal(secondary.attribution, 'Dictionary source');
  assert.deepEqual(secondary.groupedSenses, []);
});

test('a slow install check is shared and cannot resurrect a removed merge model', async t => {
  const oldCaches = globalThis.caches, oldWorker = globalThis.Worker;
  t.after(() => { globalThis.caches = oldCaches; globalThis.Worker = oldWorker; });
  let opens = 0, resolveProbe, started;
  const checking = new Promise(resolve => { started = resolve; });
  globalThis.Worker = class { constructor() { assert.fail('Removed model was started'); } };
  globalThis.caches = { open: async () => {
    opens++;
    return { has: () => new Promise(resolve => { resolveProbe = resolve; started(); }) };
  }, delete: async () => true };
  const service = await import('../js/services/meaningReference.js?interrupted-check');
  const warmup = service.preloadMeaningModel(), check = service.checkMeaningModelInstalled();
  await checking;
  assert.equal(opens, 1);
  assert.equal(service.getMeaningModelStatus().installed, false);
  await service.removeMeaningModel();
  resolveProbe(true);
  assert.equal(await check, false);
  assert.equal(await warmup, null);
  assert.equal(service.getMeaningModelStatus().phase, 'not-installed');
});
