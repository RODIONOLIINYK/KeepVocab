import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLIP_TAG, CLIP_DIMENSION, LEGACY_CLIP_TAG, PREVIOUS_CLIP_TAG, ARCHIVED_CLIP_TAGS, CLIP_CACHE, CLIP_DOWNLOAD_URLS, CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE } from '../js/ml/clipConfig.js';
import { encodeFeatures, mergeImageLearning } from '../js/services/imagePreferences.js';
import { ImageLearningHistoryStore, normalizeImageEvent } from '../js/services/imageLearningHistory.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';
import { activeImageExamples, createPersonalizer, validPersonalizer, IMAGE_PREPROCESSING } from '../js/services/imagePersonalizer.js';
import { hasDownloadedImageModel } from '../js/services/imageLearning.js';

const features = encodeFeatures([1, ...Array(CLIP_DIMENSION + 2).fill(0)]);
const record = (id, model = LEGACY_CLIP_TAG) => ({ id, model, label: 1, features, updatedAt: '2026-01-01T00:00:00.000Z' });

test('legacy settings and comparison records survive normalization, archive and restart with their encoder', async () => {
  const legacy = record('old'), pair = { ...record('pair', `${LEGACY_CLIP_TAG}:pairwise-v1`), label: 0, kind: 'comparison', preferredFeatures: features };
  const merged = mergeImageLearning({ records: [legacy, pair, record('new', CLIP_TAG)] });
  assert.deepEqual(merged.records.map(r => r.model).sort(), [CLIP_TAG, LEGACY_CLIP_TAG, `${LEGACY_CLIP_TAG}:pairwise-v1`].sort());
  const storage = new MemoryStorage(), service = new DriveSyncService(storage);
  await service.archiveLegacyImageLearning(merged);
  const restarted = new ImageLearningHistoryStore(storage, undefined);
  const archived = await restarted.all();
  assert.equal(archived.length, 3);
  assert.equal(archived.find(r => r.key === 'old').encoder, LEGACY_CLIP_TAG);
  assert.equal(archived.find(r => r.key === 'pair').encoder, LEGACY_CLIP_TAG);
  assert.equal(archived.find(r => r.key === 'pair').preferredFeatures, features);
  assert.equal(archived.find(r => r.key === 'new').encoder, CLIP_TAG);
  assert.equal(normalizeImageEvent({ ...legacy, model: undefined }).encoder, LEGACY_CLIP_TAG);
  await service.archiveLegacyImageLearning({ records: [{ ...legacy, id: 'untagged', model: undefined }] });
  assert.equal((await service.imageHistory.all()).find(r => r.key === 'untagged').encoder, LEGACY_CLIP_TAG);
});

test('training examples exclude legacy encoder and legacy personalizer weights are rejected', () => {
  const event = (id, encoder) => ({ ...record(id), encoder, meaningFeatures: features, preprocessing: IMAGE_PREPROCESSING, key: id });
  assert.deepEqual(activeImageExamples([event('old', LEGACY_CLIP_TAG), event('new', CLIP_TAG)]).map(r => r.id), ['new']);
  const model = createPersonalizer();
  assert.equal(validPersonalizer(model), true);
  assert.equal(validPersonalizer({ ...model, encoder: LEGACY_CLIP_TAG }), false);
});

test('installed model requires q4f16 vision asset, even if old q8 vision is present', async () => {
  const vision = CLIP_DOWNLOAD_URLS.find(url => url.endsWith('/onnx/vision_model_q4f16.onnx'));
  assert.ok(vision);
  assert.equal(CLIP_DOWNLOAD_URLS.some(url => url.endsWith('/onnx/vision_model_quantized.onnx')), false);
  const files = new Set(CLIP_DOWNLOAD_URLS.filter(url => url !== vision));
  files.add(vision.replace('vision_model_q4f16.onnx', 'vision_model_quantized.onnx'));
  const cacheStorage = { keys: async () => [CLIP_CACHE], open: async () => ({ match: async url => files.has(url) ? { ok: true, headers: { get: () => null } } : undefined }) };
  assert.equal(await hasDownloadedImageModel(cacheStorage), false);
  files.add(vision);
  assert.equal(await hasDownloadedImageModel(cacheStorage), true);
});

test('worker and evaluator use explicit compact q4f16 text and q4f16 vision SigLIP 2 towers', async () => {
  assert.equal(CLIP_TEXT_DTYPE, 'q4f16'); assert.equal(CLIP_VISION_DTYPE, 'q4f16');
  for (const file of ['scripts/clip-worker.js', 'scripts/image-evaluation-runtime.mjs']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /SiglipTextModel\.from_pretrained\([^\n]*dtype:\s*CLIP_TEXT_DTYPE/);
    assert.match(source, /SiglipVisionModel\.from_pretrained\([^\n]*dtype:\s*CLIP_VISION_DTYPE/);
  }
});

test('feedback cannot relabel an old vector as a new encoder when pixels cannot be embedded', async () => {
  const { driveSync } = await import('../js/services/driveSync.js?v=18908');
  const { recordImagePreference } = await import('../js/services/imageLearning.js');
  const previousStorage = globalThis.localStorage;
  const saved = { archive: driveSync.archiveLegacyImageLearning, latest: driveSync.imageHistory.latest, append: driveSync.appendImageEvent };
  const storage = new MemoryStorage(); storage.setItem('keepvocab_image_learning_device_v1', JSON.stringify({ enabled: true }));
  globalThis.localStorage = storage;
  let appended = 0;
  driveSync.archiveLegacyImageLearning = async () => {};
  driveSync.imageHistory.latest = async () => ({ ...record('old'), encoder: LEGACY_CLIP_TAG, meaningFeatures: features, preprocessing: IMAGE_PREPROCESSING });
  driveSync.appendImageEvent = async () => { appended++; };
  try {
    for (const meaningFeatures of [features, undefined]) {
      driveSync.imageHistory.latest = async () => ({ ...record('old'), encoder: LEGACY_CLIP_TAG, meaningFeatures, preprocessing: IMAGE_PREPROCESSING });
      const result = await recordImagePreference({ word: 'cat', definition: 'A cat.' }, 'good', { url: 'https://example.invalid/cat.jpg' });
      assert.equal(result.recorded, false);
      assert.equal(appended, 0);
    }
  } finally {
    driveSync.archiveLegacyImageLearning = saved.archive; driveSync.imageHistory.latest = saved.latest; driveSync.appendImageEvent = saved.append;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  }
});

test('an archive record cannot claim a new encoder while retaining a legacy model tag',()=>{
  assert.equal(normalizeImageEvent({id:'contradiction',model:LEGACY_CLIP_TAG,encoder:CLIP_TAG,label:1,features,updatedAt:'2026-10-28T12:00:00Z'}),null);
});

test('Q8-text history survives merging and restart but cannot train or initialize the FP16 model', async () => {
  const rows = ARCHIVED_CLIP_TAGS.flatMap((encoder, index) => [record(`old-${index}`, encoder), { ...record(`pair-${index}`, `${encoder}:pairwise-v1`), kind: 'comparison', label: 0, preferredFeatures: features }]);
  const merged = mergeImageLearning({ records: rows });
  assert.equal(merged.records.length, rows.length);
  const storage = new MemoryStorage(), service = new DriveSyncService(storage);
  await service.archiveLegacyImageLearning(merged);
  const history = new ImageLearningHistoryStore(storage, undefined);
  const archived = await history.all();
  assert.equal(archived.length, rows.length);
  assert.equal(archived.filter(row => row.encoder === PREVIOUS_CLIP_TAG).length, 2);
  const examples = archived.map(row => ({ ...row, meaningFeatures: features, preprocessing: IMAGE_PREPROCESSING }));
  assert.deepEqual(activeImageExamples(examples), []);
  assert.equal(validPersonalizer({ ...createPersonalizer(), encoder: PREVIOUS_CLIP_TAG }), false);
  assert.equal(normalizeImageEvent({ ...record('mismatch', PREVIOUS_CLIP_TAG), encoder: CLIP_TAG }), null);
});

test('an obsolete text cache is not a valid SigLIP 2 installation and unchanged assets retain their URLs', async () => {
  const textModel = CLIP_DOWNLOAD_URLS.find(url => url.endsWith('/text_model_q4f16.onnx'));
  assert.ok(textModel);
  assert.ok(!CLIP_DOWNLOAD_URLS.some(url => url.includes('text_model_fp16')));
  const files = new Set(CLIP_DOWNLOAD_URLS.filter(url => url !== textModel));
  files.add(textModel.replace('text_model_q4f16.onnx', 'text_model_fp16.onnx'));
  const deleted = [];
  const cacheStorage = {
    keys: async () => [CLIP_CACHE],
    open: async () => ({
      keys: async () => [...files].map(url => ({ url })),
      delete: async req => { deleted.push(req.url || req); files.delete(req.url || req); },
      match: async url => files.has(url) ? { ok: true, headers: { get: () => null } } : undefined
    })
  };
  assert.equal(await hasDownloadedImageModel(cacheStorage), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(deleted, [textModel.replace('text_model_q4f16.onnx', 'text_model_fp16.onnx')]);
  files.add(textModel);
  assert.equal(await hasDownloadedImageModel(cacheStorage), true);
});
