import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AutoTokenizer, AutoProcessor, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers';
import { CLIP_MODEL, CLIP_REVISION, CLIP_TAG, CLIP_TEXT_DTYPE, CLIP_VISION_DTYPE } from '../js/ml/clipConfig.js';
import { normalizedVector } from '../js/services/imagePreferences.js';
import { fullFrameImage } from '../js/services/imagePreprocessing.js';
import { IMAGE_PREPROCESSING } from '../js/services/imagePersonalizer.js';
import { prepareImageThumbnails } from '../js/services/imageThumbnails.js';
import { base64ToBytes } from '../js/utils/base64.js';

export async function imageEvaluationRuntime({ cacheDir = 'work/image-pretraining/cache', directory = '.', allowDownloads = false, preprocessing = IMAGE_PREPROCESSING, progress = () => {} } = {}) {
  await mkdir(cacheDir, { recursive: true }); env.cacheDir = resolve(cacheDir, 'models'); env.allowLocalModels = true;
  env.remotePathTemplate = `{model}/resolve/${CLIP_REVISION}/`;
  const settings = { revision: CLIP_REVISION, device: 'cpu', local_files_only: !allowDownloads, progress_callback: p => { if (p.status === 'done') progress({ file: p.file }); } };
  let runtime;
  const initialize = async () => runtime ||= Promise.all([AutoTokenizer.from_pretrained(CLIP_MODEL, settings), AutoProcessor.from_pretrained(CLIP_MODEL, settings), CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL, { ...settings, dtype: CLIP_TEXT_DTYPE }), CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL, { ...settings, dtype: CLIP_VISION_DTYPE })]);
  const cached = async (key, compute) => {
    const file = resolve(cacheDir, `${createHash('sha256').update(key).digest('hex')}.json`);
    try { return normalizedVector(JSON.parse(await readFile(file, 'utf8'))); } catch { /* Compute missing embeddings from pixels/text. */ }
    const vector = normalizedVector(await compute()); await writeFile(file, JSON.stringify(vector)); return vector;
  };
  const fetchImage = async url => {
    if (url.startsWith('https://local-fixture.invalid/')) {
      const name = decodeURIComponent(new URL(url).pathname.slice(1)), path = resolve(directory, name);
      if (!path.startsWith(`${resolve(directory)}/`)) throw new Error('Fixture image leaves its directory.');
      return new Response(await readFile(path), { headers: { 'content-type': 'image/jpeg' } });
    }
    const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Unsupported fixture URL.');
    return fetch(url);
  };
  return {
    preprocessing,
    async embedTexts(texts) {
      const result = [];
      for (const text of texts) result.push(await cached(`${CLIP_TAG}:text:${text}`, async () => {
        const [tokenizer, , textModel] = await initialize(), inputs = tokenizer([text], { padding: 'max_length', truncation: true });
        const output = await textModel(inputs), vector = Array.from(output.text_embeds.data);
        for (const tensor of [...Object.values(inputs), ...Object.values(output)]) tensor?.dispose?.(); return vector;
      }));
      return result;
    },
    async embedImage(candidate) {
      // The app and evaluator share download bounds, proportional resize,
      // full-frame padding, tokenizer and exact pinned quantized encoder.
      const downloadable = candidate.file ? { ...candidate, url: `https://local-fixture.invalid/${candidate.file}`, thumbnailUrl: '' } : candidate;
      const [thumbnail] = await prepareImageThumbnails([downloadable], { preferOriginal: true, fetchImpl: fetchImage,
        decode: blob => RawImage.fromBlob(blob), resize: async (image, { width, height, quality }) => {
          const resized = await image.resize(width, height); return new Blob([await resized.toSharp().jpeg({ quality: Math.round(quality * 100) }).toBuffer()], { type: 'image/jpeg' });
        } });
      if (!thumbnail) throw new Error(`Image unavailable: ${candidate.id}`);
      const bytes = base64ToBytes(thumbnail.inlineData.data), hash = createHash('sha256').update(bytes).digest('hex');
      return cached(`${CLIP_TAG}:${preprocessing}:image:${hash}`, async () => {
        const [, processor, , visionModel] = await initialize(), image = await RawImage.fromBlob(new Blob([bytes], { type: thumbnail.inlineData.mimeType }));
        const frame = preprocessing === IMAGE_PREPROCESSING ? await fullFrameImage(image, RawImage) : image;
        const inputs = await processor(frame), output = await visionModel(inputs), vector = Array.from(output.image_embeds.data);
        for (const tensor of [...Object.values(inputs), ...Object.values(output)]) tensor?.dispose?.(); return vector;
      });
    },
    async dispose() { if (runtime) { const [, , text, vision] = await runtime; await text.dispose(); await vision.dispose(); } }
  };
}
