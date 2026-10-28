// Diagnostic only: compare frozen q8 and fp32 vision towers on training photos.
// Usage: node scripts/check-image-encoder-precision.mjs [model-cache-dir] [manifest]
// The cache must already contain both vision variants and the q8 text tower.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import { fullFrameImage } from '../js/services/imagePreprocessing.js';
import { prepareImageThumbnails } from '../js/services/imageThumbnails.js';
import { base64ToBytes } from '../js/utils/base64.js';

const model = 'Xenova/mobileclip_s0', revision = '757d59c9c6870a76a4b0306f05f5061bca15c39f';
const cache = resolve(process.argv[2] || '/tmp/keepvocab-clip-check/models');
const manifestPath = resolve(process.argv[3] || 'work/image-pretraining-v2/cases.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const inputs = [
  { id: '245576', description: 'cat on keyboard' },
  { id: '137950', description: 'airplane in flight' },
  { id: '114884', description: 'buses at terminal' },
  { id: '535094', description: 'cow being bottle-fed' },
];
const prompts = ['a photo of a cat', 'a photo of an airplane', 'a photo of a bus', 'a photo of a cow'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const weights = {};
for (const file of ['text_model_quantized.onnx', 'vision_model_quantized.onnx', 'vision_model.onnx']) {
  const bytes = await readFile(resolve(cache, model, revision, 'onnx', file));
  weights[file] = { bytes: bytes.length, sha256: sha(bytes) };
}
// Ensure the examples are training photos in the frozen manifest; do not inspect labels.
for (const sample of inputs) {
  const matches = manifest.cases.filter(c => c.split === 'train').flatMap(c => c.candidates.filter(v => String(v.id) === sample.id).map(v => ({caseId: c.id, candidate: v})));
  if (!matches.length) throw Error(`${sample.id} is not in a training case`);
  const found = matches[0]; sample.caseId = found.caseId;
  const bytes = await readFile(resolve(dirname(manifestPath), found.candidate.file));
  sample.sourceSha256 = sha(bytes);
  if (sample.sourceSha256 !== found.candidate.sha256) throw Error(`Source hash mismatch for ${sample.id}`);
  sample.sourceBytes = bytes;
}
env.cacheDir = cache; env.remotePathTemplate = `{model}/resolve/${revision}/`;
const opts = { revision, device: 'cpu', local_files_only: true };
const [tokenizer, processor, textModel, q8, fp32] = await Promise.all([
  AutoTokenizer.from_pretrained(model, opts), AutoProcessor.from_pretrained(model, opts),
  CLIPTextModelWithProjection.from_pretrained(model, { ...opts, dtype: 'q8' }),
  CLIPVisionModelWithProjection.from_pretrained(model, { ...opts, dtype: 'q8' }),
  CLIPVisionModelWithProjection.from_pretrained(model, { ...opts, dtype: 'fp32' }),
]);
const cos = (a,b) => a.reduce((sum,x,i) => sum + x*b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
try {
  const vectors = [];
  for (const prompt of prompts) {
    const tokens = tokenizer([prompt], { padding: 'max_length', truncation: true });
    const output = await textModel(tokens); vectors.push(Array.from(output.text_embeds.data));
    for (const tensor of [...Object.values(tokens), ...Object.values(output)]) tensor?.dispose?.();
  }
  const results = [];
  for (const sample of inputs) {
    // Identical app/evaluation thumbnail encode, full-frame padding and processor.
    const [thumb] = await prepareImageThumbnails([{ id: sample.id, url: `https://local-fixture.invalid/${sample.id}.jpg` }], {
      preferOriginal: true, fetchImpl: async () => new Response(sample.sourceBytes, { headers: { 'content-type': 'image/jpeg' } }),
      decode: blob => RawImage.fromBlob(blob),
      resize: async (image, { width, height, quality }) => new Blob([await (await image.resize(width, height)).toSharp().jpeg({ quality: Math.round(quality * 100) }).toBuffer()], { type: 'image/jpeg' }),
    });
    if (!thumb) throw Error(`Unable to prepare ${sample.id}`);
    const image = await RawImage.fromBlob(new Blob([base64ToBytes(thumb.inlineData.data)], {type: thumb.inlineData.mimeType}));
    const processed = await processor(await fullFrameImage(image, RawImage));
    const q = await q8(processed), f = await fp32(processed);
    const qv = Array.from(q.image_embeds.data), fv = Array.from(f.image_embeds.data);
    results.push({ id: sample.id, caseId: sample.caseId, description: sample.description, sourceSha256: sample.sourceSha256,
      q8VsFp32VisionCosine: cos(qv,fv), q8Scores: vectors.map(t => cos(qv,t)), fp32Scores: vectors.map(t => cos(fv,t)) });
    for (const tensor of [...Object.values(processed), ...Object.values(q), ...Object.values(f)]) tensor?.dispose?.();
  }
  console.log(JSON.stringify({ model, revision, weights, textDtype: 'q8', visionDtypes: ['q8', 'fp32'], prompts,
    preprocessing: 'app thumbnail JPEG, full-frame 256 padding, pinned processor',
    source: { modelConfig: `https://huggingface.co/${model}/blob/${revision}/config.json`, quantizationNote: `https://huggingface.co/${model}/discussions/3/files` }, results }, null, 2));
} finally { await Promise.all([textModel.dispose(), q8.dispose(), fp32.dispose()]); }
