import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { imageEvaluationRuntime } from './image-evaluation-runtime.mjs';
import { CLIP_DIMENSION, CLIP_TAG } from '../js/ml/clipConfig.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = resolve(root, 'tests/fixtures/meaning-taxonomy/dataset.json');
const outputArg = process.argv.findIndex(arg => arg === '--output');
if (outputArg !== -1) assert(process.argv[outputArg + 1], 'Provide a path after --output.');
const outputPath = resolve(outputArg === -1
  ? resolve(root, 'tests/fixtures/meaning-taxonomy/embeddings.json.gz')
  : process.argv[outputArg + 1]);

const audit = spawnSync(process.execPath, [resolve(root, 'scripts/audit-meaning-taxonomy.mjs')], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'inherit']
});
if (audit.error) throw audit.error;
assert.equal(audit.status, 0, `Meaning taxonomy audit failed with status ${audit.status}.`);

const datasetBytes = await readFile(datasetPath);
const dataset = JSON.parse(datasetBytes.toString('utf8'));
assert(Array.isArray(dataset.items), 'Meaning taxonomy dataset must contain items.');
const ids = dataset.items.map(row => row.id);
assert.equal(new Set(ids).size, ids.length, 'Dataset IDs must be unique.');
const prompts = dataset.items.map(row => `A photo illustrating ${row.word} (${row.partOfSpeech || 'word'}): ${row.definition}`);
const sha256 = value => createHash('sha256').update(value).digest('hex');

const runtime = await imageEvaluationRuntime({ cacheDir: resolve(root, 'work/image-pretraining/cache'), allowDownloads: false });
try {
  const vectors = [];
  for (let start = 0; start < prompts.length; start += 40) {
    vectors.push(...await runtime.embedTexts(prompts.slice(start, start + 40)));
    const complete = Math.min(start + 40, prompts.length);
    if (complete % 40 === 0 || complete === prompts.length) console.log(`Encoded ${complete}/${prompts.length} texts.`);
  }

  assert.equal(vectors.length, dataset.items.length, 'Embedding count must match dataset count.');
  const rows = dataset.items.map((row, index) => {
    const vector = vectors[index];
    assert(Array.isArray(vector), `Missing vector for ${row.id}.`);
    assert.equal(vector.length, CLIP_DIMENSION, `Wrong vector dimension for ${row.id}.`);
    assert(vector.every(Number.isFinite), `Non-finite vector value for ${row.id}.`);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    assert(Math.abs(norm - 1) <= 1e-5, `Vector for ${row.id} is not unit normalized (${norm}).`);
    return { id: row.id, promptSha256: sha256(prompts[index]), vector };
  });
  assert.deepEqual(rows.map(row => row.id), ids, 'Output IDs must exactly cover dataset IDs in order.');
  assert.equal(new Set(rows.map(row => row.id)).size, dataset.items.length, 'Output IDs must be unique.');

  const artifact = {
    schemaVersion: 1,
    task: 'meaning-category-membership',
    encoder: CLIP_TAG,
    dimension: CLIP_DIMENSION,
    inputProtocol: 'A photo illustrating ${word} (${partOfSpeech || "word"}): ${definition}; original definition only, no labels, rationales, or generated scenes.',
    datasetFileSha256: sha256(datasetBytes),
    rows
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, gzipSync(Buffer.from(JSON.stringify(artifact)), { level: 9, mtime: 0 }));
  console.log(`Wrote ${rows.length} embeddings to ${outputPath}.`);
} finally {
  await runtime.dispose();
}
