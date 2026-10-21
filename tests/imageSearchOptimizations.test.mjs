import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisualSceneDescriptions, prepareImageScenes, generateVisualScenesWithGemini, imageSenseFingerprint, imageSceneRecordFor, findRelevantImages, findPexelsImages, rankImageCandidates, updateImageFeedback, rerankImagesWithGemini } from '../js/services/imageSearch.js';

function storage() {
  const data = new Map([['keepvocab_gemini_live_key_v1', 'test-image-api-key']]);
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
const scene = 'person balancing stones beside quiet water';
const response = result => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) });
const requestedSenses = options => JSON.parse(JSON.parse(options.body).contents[0].parts[0].text.split('Senses: ')[1].split('\n')[0]);
const sense = id => ({ word: `imageprobe${id}`, partOfSpeech: 'adjective', definition: `A particular difficult meaning number ${id} which needs an exact visible illustration.` });

test('physical objects and reviewed exact curated meanings avoid API calls; broad emotions and permanence do not masquerade as exact scenes', async () => {
  const words = [{ word: 'wrench', partOfSpeech: 'noun', definition: 'A metal tool used for gripping and turning nuts and bolts.' }, { word: 'conquest', definition: 'A victory gained through force.' }];
  const results = await prepareImageScenes(words, { storage: storage(), fetchImpl: () => assert.fail('Safe local scenes need no API call') });
  assert.deepEqual(results.map(word => word.imageScenes.source), ['object', 'curated']);
  assert.deepEqual(results[0].imageScenes.scenes, ['wrench']);
  assert.deepEqual(buildVisualSceneDescriptions({ word: 'permanent', definition: 'Lasting forever, with no end.' }), []);
  assert.deepEqual(buildVisualSceneDescriptions({ word: 'feeling', definition: 'An emotion or mood.' }), []);
  assert.ok(buildVisualSceneDescriptions({ word: 'disdain', definition: 'A feeling of contempt or scorn.' }).every(item => /curled lip|dismissive|rolling eyes/.test(item)));
  let calls = 0;
  const [bat] = await prepareImageScenes([{ word: 'bat', partOfSpeech: 'noun', definition: 'A wooden tool used to hit a ball in baseball.' }], {
    storage: storage(), fetchImpl: async () => { calls++; return response({ scenes: ['player swinging wooden club toward baseball'] }); }
  });
  assert.equal(calls, 1);
  assert.equal(bat.imageScenes.source, 'gemini');
});

test('scene records survive renderer restart and wording edits, but semantic and generator changes invalidate them', async () => {
  const saved = storage(); const word = { ...sense('cache'), sourceDefinition: 'An unfamiliar quality that requires careful visible interpretation.' };
  let calls = 0;
  const fetchImpl = async () => { calls++; return response({ scenes: [scene] }); };
  const [prepared] = await prepareImageScenes([word], { storage: saved, fetchImpl });
  assert.equal(prepared.definition, word.definition);
  assert.equal(word.imageScenes, undefined);
  const restarted = await import('../js/services/imageSearch.js?restart-image-cache');
  const [cached] = await restarted.prepareImageScenes([{ ...word, definition: 'A simpler learner wording.' }], { storage: saved, fetchImpl });
  assert.deepEqual(cached.imageScenes, prepared.imageScenes);
  assert.equal(calls, 1);
  await restarted.prepareImageScenes([{ ...word, sourceDefinition: 'An entirely different quality needing another visual.' }], { storage: saved, fetchImpl });
  assert.equal(calls, 2);
  const old = { ...sense('oldgenerator'), imageScenes: { ...prepared.imageScenes, fingerprint: imageSenseFingerprint(sense('oldgenerator')), generatorVersion: '0' } };
  assert.equal(imageSceneRecordFor(old, { storage: saved }), null);
  await prepareImageScenes([old], { storage: saved, fetchImpl });
  assert.equal(calls, 3);
});

test('bulk scene generation batches twenty distinct senses and shares concurrent single-word requests', async () => {
  const saved = storage(); const batches = [];
  const words = Array.from({ length: 25 }, (_, index) => sense(`batch${index}`));
  const fetchImpl = async (_url, options) => {
    const items = requestedSenses(options); batches.push(items);
    await new Promise(resolve => setTimeout(resolve, 1));
    return response({ items: items.map(item => ({ id: item.id, scenes: [scene] })) });
  };
  const bulk = prepareImageScenes(words, { storage: saved, fetchImpl, sceneBatchSize: 20 });
  const single = generateVisualScenesWithGemini(words[0], { storage: saved, fetchImpl });
  const [prepared, scenes] = await Promise.all([bulk, single]);
  assert.deepEqual(batches.map(batch => batch.length), [20, 5]);
  assert.ok(prepared.every(word => word.imageScenes.scenes[0] === scene));
  assert.deepEqual(scenes, [scene]);
});

test('partial batches retry only failed IDs once and do not persist malformed or empty results', async () => {
  const words = [sense('partial0'), sense('partial1'), sense('partial2')];
  const batches = []; const saved = storage();
  const fetchImpl = async (_url, options) => {
    const items = requestedSenses(options); batches.push(items.map(item => item.id));
    if (batches.length === 1) return response({ items: [{ id: items[0].id, scenes: [scene] }] });
    return response({ items: [{ id: items[0].id, scenes: [scene] }, { id: items[0].id, scenes: [scene] }, { id: items[1].id, scenes: [scene] }] });
  };
  const result = await prepareImageScenes(words, { storage: saved, fetchImpl });
  assert.deepEqual(batches, [['sense-0', 'sense-1', 'sense-2'], ['sense-1', 'sense-2']]);
  assert.ok(result[0].imageScenes); assert.equal(result[1].imageScenes, undefined); assert.ok(result[2].imageScenes);
  assert.deepEqual(await generateVisualScenesWithGemini(words[1], { storage: saved, fetchImpl }), []);
  assert.equal(batches.length, 2);
});

test('quota failures stop later batches and one dismissed consumer does not cancel shared scene generation', async () => {
  let quotaCalls = 0;
  const failed = await prepareImageScenes(Array.from({ length: 25 }, (_, index) => sense(`quota${index}`)), {
    storage: storage(), fetchImpl: async () => { quotaCalls++; return { ok: false, status: 429, json: async () => ({ error: { message: 'Quota exhausted' } }) }; }
  });
  assert.equal(quotaCalls, 1);
  assert.ok(failed.every(word => !word.imageScenes));

  const controller = new AbortController(); const saved = storage(); const word = sense('cancelledconsumer');
  let release; let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    assert.equal(options.signal.aborted, false);
    return response({ scenes: [scene] });
  };
  const dismissed = prepareImageScenes([word], { storage: saved, fetchImpl, signal: controller.signal });
  const needed = prepareImageScenes([word], { storage: saved, fetchImpl });
  controller.abort(); release();
  const [, result] = await Promise.all([dismissed, needed]);
  assert.equal(calls, 1);
  assert.equal(result[0].imageScenes.scenes[0], scene);
});

test('approved URLs affect ranking, rejected source URLs suppress variants, and feedback stays within its exact sense', () => {
  const original = sense('feedback');
  const candidates = [0, 1, 2].map(index => ({ url: `https://example.test/${index}.jpg`, sourceUrl: `https://example.test/source/${index}`, title: `Person balancing stones ${index}`, source: 'Example' }));
  const word = { ...original, imageFeedback: updateImageFeedback(original, 'good', candidates[2]) };
  assert.equal(rankImageCandidates(candidates, word, { concepts: ['person balancing stones'] })[0].url, candidates[2].url);
  word.imageFeedback = updateImageFeedback(word, 'wrong', candidates[2]);
  assert.deepEqual(rankImageCandidates([{ ...candidates[2], url: 'https://example.test/resized.jpg' }], word, { concepts: ['person balancing stones'] }), []);
  const changed = { ...word, definition: 'A changed meaning with different image requirements.' };
  assert.equal(rankImageCandidates([candidates[2]], changed, { concepts: ['person balancing stones'] }).length, 1);
});

test('search ranks the whole bounded candidate pool before choosing a small result set and avoids needless pixel loads', async () => {
  let loads = 0;
  const images = Array.from({ length: 40 }, (_, index) => ({ title: index === 39 ? 'Unique pool river bank scene' : `River bank ${index}`, thumbnail: `https://pool.test/${index}.jpg`, foreign_landing_url: `https://pool.test/source/${index}`, tags: ['river', 'bank'] }));
  const found = await findRelevantImages(sense('widepool'), { aiScenes: false, extraQueries: ['unique pool river bank scene'], onlyExtraQueries: true, limit: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: images }) }), loadImage: async () => { loads++; return true; }
  });
  assert.equal(found[0].url, 'https://pool.test/39.jpg');
  assert.ok(loads <= 2);
});

test('Pexels exposes medium previews rather than full-size image URLs', async () => {
  const found = await findPexelsImages('medium-preview-optimization', 'key', async () => ({ ok: true, json: async () => ({ photos: [{ url: 'https://pexels.test/source', alt: 'Medium preview', src: { medium: 'https://pexels.test/medium.jpg', large: 'https://pexels.test/large.jpg' } }] }) }));
  assert.equal(found[0].url, 'https://pexels.test/medium.jpg');
  assert.equal(found[0].thumbnailUrl, found[0].url);
});

test('optional hard-case vision sends at most four verified small thumbnails, ignores invented IDs, and caches its ranking', async () => {
  const saved = storage(); let imageCalls = 0; let visionCalls = 0;
  const candidates = Array.from({ length: 8 }, (_, index) => ({ url: `https://vision.test/full/${index}.jpg`, thumbnailUrl: `https://vision.test/preview/${index}.jpg`, title: 'Person balancing stones', searchQuery: 'person balancing stones' }));
  const options = { storage: saved, semanticRerank: true,
    fetchImpl: async (url, request) => {
      if (url.includes('generativelanguage.googleapis.com')) {
        visionCalls++;
        const images = JSON.parse(request.body).contents[0].parts.filter(part => part.inlineData);
        assert.equal(images.length, 4);
        for (const image of images) { const size = JSON.parse(Buffer.from(image.inlineData.data, 'base64').toString()); assert.ok(size.width <= 384 && size.height <= 384); }
        return response({ ranking: [6, 1, 1, 0] });
      }
      imageCalls++; assert.ok(url.includes('/preview/'));
      return new Response('original', { headers: { 'content-type': 'image/jpeg' } });
    },
    decode: async blob => { const value = await blob.text(); return value === 'original' ? { width: 1200, height: 600 } : JSON.parse(value); },
    resize: async (_image, size) => new Blob([JSON.stringify({ width: size.width, height: size.height })], { type: 'image/jpeg' })
  };
  const word = sense('vision');
  assert.equal((await rerankImagesWithGemini(word, candidates, { ...options, semanticRerank: false }))[0], candidates[0]);
  const result = await rerankImagesWithGemini(word, candidates, options);
  assert.equal(result[0], candidates[1]); assert.equal(result[1], candidates[0]);
  await rerankImagesWithGemini(word, candidates, options);
  assert.equal(imageCalls, 4); assert.equal(visionCalls, 1);
});
