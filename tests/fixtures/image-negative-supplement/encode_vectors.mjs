// Encode reviewed image pixels and paired target prompts only; no model fitting.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { imageEvaluationRuntime } from '../../../scripts/image-evaluation-runtime.mjs';
import { imageClipPrompts } from '../../../js/services/imageLearning.js';
import { CLIP_MODEL, CLIP_REVISION, CLIP_TAG, CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE } from '../../../js/ml/clipConfig.js';
import { IMAGE_PREPROCESSING } from '../../../js/services/imagePersonalizer.js';

const root = resolve('work/image-negative-supplement');
const fixture = new URL('.', import.meta.url);
const manifestBytes = await readFile(new URL('manifest.json', fixture));
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const runtime = await imageEvaluationRuntime({ directory: root, allowDownloads: false });
const items = [];
try {
  for (let i = 0; i < manifest.items.length; i++) {
    const item = manifest.items[i];
    const bytes = await readFile(resolve(root, item.path));
    const assetSha256 = createHash('sha256').update(bytes).digest('hex');
    const expected = item.distractorKind === 'photo' ? item.source.sha256 : item.source.sha256;
    if (assetSha256 !== expected) throw new Error(`Asset hash mismatch for ${item.id}`);
    const imageVector = await runtime.embedImage({ id: item.id, file: item.path });
    const promptData = imageClipPrompts(item.target);
    const textVectors = await runtime.embedTexts(promptData.texts);
    items.push({ id: item.id, suitabilityLabel: item.suitabilityLabel, distractorKind: item.distractorKind,
      targetMeaningId: item.target.meaningId, assetSha256, targetPrompts: promptData.texts,
      imageVector, textVectors });
    if ((i + 1) % 6 === 0 || i + 1 === manifest.items.length) console.log(`encoded ${i + 1}/${manifest.items.length}`);
  }
} finally { await runtime.dispose(); }
const payload = { kind: 'image-negative-supplement-embeddings', task: 'semantic', evidence: 'local-cached-encoder-on-reviewed-pixels',
  trained: false, personalPreference: false, sourceManifest: 'tests/fixtures/image-negative-supplement/manifest.json',
  encoder: { model: CLIP_MODEL, revision: CLIP_REVISION, tag: CLIP_TAG, textDtype: CLIP_TEXT_DTYPE, visionDtype: CLIP_VISION_DTYPE },
  preprocessing: IMAGE_PREPROCESSING, sourceManifestSha256: manifestSha256, count: items.length, items };
await writeFile(new URL('vectors.json.gz', fixture), gzipSync(Buffer.from(JSON.stringify(payload))));
