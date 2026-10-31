import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { meaningCategoryProbabilities, validMeaningCategoryClassifier } from './lib/meaning-category-classifier.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = resolve(root, 'tests/fixtures/meaning-taxonomy/expanded-1000');
const outputPath = resolve(root, 'docs/meaning-taxonomy-training/expanded-1000/resources.json');
const warmupCalls = 5000;
const measuredCalls = 3000;
const candidates = [
  { name: 'linear', file: 'classifier-linear.json' },
  { name: '32-unit', file: 'classifier-32.json' }
];
assert.equal(process.platform, 'darwin', 'Run this resource benchmark on macOS.');
assert.equal(process.arch, 'arm64', 'Run this resource benchmark on Apple Silicon only.');

const embeddingsBytes = await readFile(resolve(fixtureDir, 'embeddings.json.gz'));
const embeddings = JSON.parse(gunzipSync(embeddingsBytes).toString('utf8'));
assert.equal(embeddings.dimension, 512, 'Expected saved 512-D MobileCLIP vectors.');
assert(embeddings.rows.length > 0, 'Expected cached expanded dataset vectors.');
for (const row of embeddings.rows) {
  assert(Array.isArray(row.vector) && row.vector.length === 512 && row.vector.every(Number.isFinite), `Invalid vector ${row.id}.`);
}

const percentile = (sorted, p) => sorted[Math.ceil(p * sorted.length) - 1];
const benchmark = async ({ name, file }) => {
  const modelBytes = await readFile(resolve(fixtureDir, file));
  const model = JSON.parse(modelBytes.toString('utf8'));
  assert(validMeaningCategoryClassifier(model), `Invalid saved model ${file}.`);

  let vectorIndex = 0;
  const infer = () => {
    const vector = embeddings.rows[vectorIndex].vector;
    vectorIndex = (vectorIndex + 1) % embeddings.rows.length;
    return meaningCategoryProbabilities(model, vector);
  };

  // The public inference path validates the full model on each call; keep that
  // cost inside each timed sample to reflect the existing runtime contract.
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
  const preprocessingCoordinateCount = model.preprocessor.mean.length + model.preprocessor.scale.length;

  return {
    name,
    artifact: `tests/fixtures/meaning-taxonomy/expanded-1000/${file}`,
    actualModelJSONbytes: modelBytes.byteLength,
    parameterCount,
    multiplyAccumulateCountPerCall: multiplyAccumulateCount,
    float32PayloadBytes: {
      parameters: parameterCount * Float32Array.BYTES_PER_ELEMENT,
      preprocessingMeanAndScale: preprocessingCoordinateCount * Float32Array.BYTES_PER_ELEMENT,
      combined: (parameterCount + preprocessingCoordinateCount) * Float32Array.BYTES_PER_ELEMENT
    },
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
const results = [];
for (const candidate of candidates) results.push(await benchmark(candidate));
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  benchmark: 'meaningCategoryProbabilities on cached expanded-dataset vectors',
  runtime: {
    node: process.version,
    osArch: os.arch(),
    platform: process.platform,
    cpuModel
  },
  scope: {
    deviceClass: 'Apple Silicon desktop Mac',
    noPhoneMeasurementPerformed: true,
    embeddingSource: 'Actual saved 512-D vectors from tests/fixtures/meaning-taxonomy/expanded-1000/embeddings.json.gz, rotated round-robin.',
    includes: 'Public classifier function validation, JS preprocessing, dense head inference, sigmoid calibration, and per-call performance.now timing overhead.',
    excludes: 'CLIP text encoding, model loading, phone inference, and battery or thermal measurements.',
    footnotes: 'Latency describes this desktop Node run only. Float32 payload is a numeric storage estimate; actual runtime uses JavaScript Numbers and arrays, so object/runtime overhead is not included. MAC counts cover dense-layer multiply-accumulates only.'
  },
  embeddingVectorCount: embeddings.rows.length,
  results
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
