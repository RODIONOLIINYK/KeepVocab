import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGunzip, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CLIP_MODEL_BASE, COMPACT_MODEL_ASSETS, COMPACT_RUNTIME_ASSET, CLIP_RUNTIME_URLS } from '../js/ml/clipConfig.js';
import { fetchCompactModelFile } from '../js/services/compactModelDownload.js';

test('compressed multipart download reconstructs the exact canonical file and rejects corruption', async () => {
  const saved = COMPACT_MODEL_ASSETS['tokenizer.json'], body = Buffer.from('{"vocab":"all languages"}');
  const compressed = gzipSync(body), split = Math.floor(compressed.length / 2), calls = [];
  COMPACT_MODEL_ASSETS['tokenizer.json'] = { gzip: true, parts: ['one', 'two'], bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  try {
    const metadata = await fetchCompactModelFile(`${CLIP_MODEL_BASE}tokenizer.json`, { headers: { Range: 'bytes=0-0' } }, () => assert.fail('A metadata probe must not download the model twice'));
    assert.equal(metadata.status, 206); assert.equal(metadata.headers.get('content-range'), `bytes 0-0/${body.length}`);
    const response = await fetchCompactModelFile(`${CLIP_MODEL_BASE}tokenizer.json`, {}, async url => { calls.push(url); return new Response(url.endsWith('one') ? compressed.subarray(0, split) : compressed.subarray(split)); });
    assert.equal(await response.text(), body.toString()); assert.deepEqual(calls, [`${CLIP_MODEL_BASE}one`, `${CLIP_MODEL_BASE}two`]);
    COMPACT_MODEL_ASSETS['tokenizer.json'].sha256 = '0'.repeat(64);
    await assert.rejects(fetchCompactModelFile(`${CLIP_MODEL_BASE}tokenizer.json`, {}, async url => new Response(url.endsWith('one') ? compressed.subarray(0, split) : compressed.subarray(split))), /checksum/);
    await assert.rejects(fetchCompactModelFile(`${CLIP_MODEL_BASE}tokenizer.json`, {}, async () => new Response('', { status: 404 })), /404/);
  } finally { COMPACT_MODEL_ASSETS['tokenizer.json'] = saved; }
});
test('published shards contain a real model with pinned integrity and a complete multilingual pack below 220 MB', async () => {
  const root = new URL('../models/siglip2-compact-v1/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
  assert.equal(manifest.vocabularySize, 256000); assert.ok(manifest.downloadBytes < 220_000_000);
  assert.ok(manifest.files['onnx/text_model_q4f16.onnx'].bytes + manifest.files['onnx/vision_model_q4f16.onnx'].bytes < 220_000_000);
  const asset = COMPACT_MODEL_ASSETS['onnx/text_model_q4f16.onnx'];
  async function* chunks() { for (const part of asset.parts) { assert.ok((await stat(new URL(part, root))).size < 100_000_000); for await (const chunk of createReadStream(new URL(part, root))) yield chunk; } }
  const { Readable } = await import('node:stream');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of Readable.from(chunks()).pipe(createGunzip())) { hash.update(chunk); bytes += chunk.length; }
  assert.equal(bytes, asset.bytes); assert.equal(hash.digest('hex'), asset.sha256);
  assert.ok(manifest.totalDownloadBytes < 220_000_000, 'Include runtime in download budget');
  const runtime = await fetchCompactModelFile(CLIP_RUNTIME_URLS[1], {}, async url =>
    new Response(await readFile(new URL(new URL(url).pathname.split('/').at(-1), root))));
  assert.equal(runtime.headers.get('content-type'), 'application/wasm');
  assert.equal((await runtime.arrayBuffer()).byteLength, COMPACT_RUNTIME_ASSET.bytes);
});
