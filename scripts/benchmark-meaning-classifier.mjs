import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { meaningCategoryProbabilities, validMeaningCategoryClassifier } from './lib/meaning-category-classifier.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = resolve(root, 'tests/fixtures/meaning-taxonomy');
const outputPath = resolve(root, 'docs/meaning-taxonomy-training/mobile-head-benchmark.json');
const warmupCalls = 300;
const measuredCalls = 2000;
const candidates = [
  { name: 'linear', file: 'classifier-linear.json' },
  { name: '8-unit', file: 'classifier-soft-candidate.json' },
  { name: '32-unit', file: 'classifier.json' }
];
const embeddingsBytes = await readFile(resolve(fixtures, 'embeddings.json.gz'));
const embeddings = JSON.parse(gunzipSync(embeddingsBytes).toString('utf8'));
assert.equal(embeddings.dimension, 512, 'Expected saved 512-D MobileCLIP vectors.');
assert(embeddings.rows.length > 0, 'Expected at least one cached embedding vector.');
for (const row of embeddings.rows) {
  assert(Array.isArray(row.vector) && row.vector.length === 512 && row.vector.every(Number.isFinite), `Invalid vector ${row.id}.`);
}

const percentile = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];
const benchmark = async ({ name, file }) => {
  const modelBytes = await readFile(resolve(fixtures, file));
  const model = JSON.parse(modelBytes.toString('utf8'));
  assert(validMeaningCategoryClassifier(model), `Invalid saved model ${file}.`);
  let vectorIndex = 0;
  const infer = () => {
    const vector = embeddings.rows[vectorIndex].vector;
    vectorIndex = (vectorIndex + 1) % embeddings.rows.length;
    return meaningCategoryProbabilities(model, vector);
  };

  for (let i = 0; i < warmupCalls; i++) infer();
  const timingsMs = new Array(measuredCalls);
  for (let i = 0; i < measuredCalls; i++) {
    const start = performance.now();
    const probabilities = infer();
    timingsMs[i] = performance.now() - start;
    assert.equal(probabilities.length, model.categories.length);
  }
  timingsMs.sort((a, b) => a - b);
  const meanMs = timingsMs.reduce((sum, value) => sum + value, 0) / timingsMs.length;
  const parameterCount = model.layers.reduce((sum, layer) => sum + layer.bias.length
    + layer.weights.reduce((weightSum, row) => weightSum + row.length, 0), 0);
  const multiplyAccumulateCount = model.layers.reduce((sum, layer) => sum
    + layer.weights.length * layer.weights[0].length, 0);
  return {
    name,
    artifact: `tests/fixtures/meaning-taxonomy/${file}`,
    modelJSONbytes: modelBytes.byteLength,
    parameterCount,
    numericFootprintEstimateBytes: {
      float32Parameters: parameterCount * Float32Array.BYTES_PER_ELEMENT,
      preprocessingMeanAndScale: (model.preprocessor.mean.length + model.preprocessor.scale.length) * Float32Array.BYTES_PER_ELEMENT,
      scope: 'Numeric payload estimate only; excludes JavaScript arrays, object/runtime overhead, code and loaded embedding vectors.'
    },
    multiplyAccumulateCountPerCall: multiplyAccumulateCount,
    calls: { warmup: warmupCalls, measured: measuredCalls },
    latencyMs: {
      p50: percentile(timingsMs, 0.50),
      p95: percentile(timingsMs, 0.95),
      mean: meanMs
    },
    throughputCallsPerSecondFromMean: 1000 / meanMs
  };
};

const cpuModel = os.cpus()[0]?.model ?? null;
const adb = spawnSync('adb', ['devices'], { encoding: 'utf8' });
const androidConnected = adb.status === 0
  ? adb.stdout.split('\n').some(line => /\S+\s+device\s*$/.test(line)) : null;
const results = [];
for (const candidate of candidates) results.push(await benchmark(candidate));
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  benchmark: 'meaningCategoryProbabilities on cached fixture vectors',
  runtime: {
    node: process.version,
    osArch: os.arch(),
    platform: process.platform,
    cpuModel
  },
  scope: {
    deviceClass: 'Apple Silicon desktop Mac',
    physicalAndroidDeviceConnected: androidConnected,
    inferenceInput: 'Actual saved 512-D embeddings from tests/fixtures/meaning-taxonomy/embeddings.json.gz; vectors rotate round-robin.',
    includes: 'Public classifier function validation, JS preprocessing, dense head inference, and output sigmoid; measured per-call performance.now timing overhead is included.',
    excludes: 'CLIP text encoding, model loading, network, Android runtime, device thermal/battery behavior.',
    footnotes: 'Latency and throughput describe this desktop run only and are not phone performance claims. Float32 byte values are numeric payload estimates; actual implementation uses JavaScript Numbers and arrays, whose memory overhead is excluded.'
  },
  embeddingVectorCount: embeddings.rows.length,
  results
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
