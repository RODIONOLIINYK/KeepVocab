import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisualSceneDescriptions, compactGeneratedScene, compactVisualSearchQuery, isConcreteVisualScene, prepareImageScenes, generateVisualScenesWithGemini, imageSenseFingerprint, imageSceneRecordFor, findRelevantImages, findPexelsImages, rankImageCandidates, updateImageFeedback } from '../js/services/imageSearch.js';

function storage() {
  const data = new Map([['keepvocab_gemini_live_key_v1', 'test-image-api-key']]);
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
const scene = 'person balancing stones beside quiet water';
const alternate = 'hands stacking smooth rocks beside a stream';
const pair = [scene, alternate];
const response = result => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) });
const requestedSenses = options => JSON.parse(JSON.parse(options.body).contents[0].parts[0].text.split('Senses: ')[1].split('\n')[0]);
const sense = id => ({ word: `imageprobe${id}`, partOfSpeech: 'adjective', definition: `A particular difficult meaning number ${id} which needs an exact visible illustration.` });

test('physical objects and reviewed exact curated meanings avoid API calls; broad emotions and permanence do not masquerade as exact scenes', async () => {
  const words = [{ word: 'wrench', partOfSpeech: 'noun', definition: 'A metal tool used for gripping and turning nuts and bolts.' }, { word: 'conquest', definition: 'A victory gained through force.' }];
  const results = await prepareImageScenes(words, { storage: storage(), fetchImpl: () => assert.fail('Safe local scenes need no API call') });
  assert.deepEqual(results.map(word => word.imageScenes.source), ['object', 'curated']);
  assert.deepEqual(results[0].imageScenes.scenes, ['wrench', 'close up view of wrench']);
  assert.deepEqual(buildVisualSceneDescriptions({ word: 'permanent', definition: 'Lasting forever, with no end.' }), []);
  assert.deepEqual(buildVisualSceneDescriptions({ word: 'feeling', definition: 'An emotion or mood.' }), []);
  assert.ok(buildVisualSceneDescriptions({ word: 'disdain', definition: 'A feeling of contempt or scorn.' }).every(item => /curled lip|dismissive|rolling eyes/.test(item)));
  let calls = 0;
  const [bat] = await prepareImageScenes([{ word: 'bat', partOfSpeech: 'noun', definition: 'A wooden tool used to hit a ball in baseball.' }], {
    storage: storage(), fetchImpl: async () => { calls++; return response({ scenes: ['player swinging wooden club toward baseball', 'child hitting ball across a grassy field'] }); }
  });
  assert.equal(calls, 1);
  assert.equal(bat.imageScenes.source, 'gemini');
});

test('scene records survive renderer restart and wording edits, but semantic and generator changes invalidate them', async () => {
  const saved = storage(); const word = { ...sense('cache'), sourceDefinition: 'An unfamiliar quality that requires careful visible interpretation.' };
  let calls = 0;
  const fetchImpl = async () => { calls++; return response({ scenes: pair }); };
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
    return response({ items: items.map(item => ({ id: item.id, scenes: pair })) });
  };
  const bulk = prepareImageScenes(words, { storage: saved, fetchImpl, sceneBatchSize: 20 });
  const single = generateVisualScenesWithGemini(words[0], { storage: saved, fetchImpl });
  const [prepared, scenes] = await Promise.all([bulk, single]);
  assert.deepEqual(batches.map(batch => batch.length), [20, 5]);
  assert.ok(prepared.every(word => word.imageScenes.scenes[0] === scene));
  assert.deepEqual(scenes, pair);

  const distinctSingles = [sense('coalesce0'), sense('coalesce1'), sense('coalesce2')];
  const coalesced = await Promise.all(distinctSingles.map(item => generateVisualScenesWithGemini(item, { storage: saved, fetchImpl })));
  assert.deepEqual(batches.map(batch => batch.length), [20, 5, 3]);
  assert.ok(coalesced.every(items => items[0] === scene));
});

test('partial batches retry only failed IDs once and do not persist malformed or empty results', async () => {
  const words = [sense('partial0'), sense('partial1'), sense('partial2')];
  const batches = []; const saved = storage();
  const fetchImpl = async (_url, options) => {
    const items = requestedSenses(options); batches.push(items.map(item => item.id));
    if (batches.length === 1) return response({ items: [{ id: items[0].id, scenes: pair }] });
    return response({ items: [{ id: items[0].id, scenes: pair }, { id: items[0].id, scenes: pair }, { id: items[1].id, scenes: pair }] });
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
    return response({ scenes: pair });
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

test('rejecting a photo preserves peers from its prompt and excludes resized Pexels aliases', () => {
  const original = sense('fox-feedback');
  const prompt = 'running fox across meadow';
  const standing = { url: 'https://images.pexels.com/photos/73101/pexels-photo-73101.jpeg?w=350&h=200', sourceUrl: 'https://www.pexels.com/photo/standing-fox-73101/', title: 'Fox standing in meadow', source: 'Pexels', searchQuery: prompt };
  const running = { url: 'https://images.pexels.com/photos/73102/pexels-photo-73102.jpeg?w=350', sourceUrl: 'https://www.pexels.com/photo/running-fox-73102/', title: 'Fox running across meadow', source: 'Pexels', searchQuery: prompt };
  const word = { ...original, imageFeedback: updateImageFeedback(original, 'wrong', standing) };
  const resized = { ...standing, url: standing.url.replace('w=350&h=200', 'w=900'), sourceUrl: '' };
  const ranked = rankImageCandidates([resized, running], word, { concepts: [prompt] });
  assert.deepEqual(ranked, [running]);
  assert.deepEqual(word.imageFeedback.preferredConcepts, []);

  word.imageFeedback = updateImageFeedback(word, 'good', resized);
  assert.deepEqual(word.imageFeedback.rejectedUrls, []);
  assert.equal(rankImageCandidates([standing], word, { concepts: [prompt] }).length, 1);
  word.imageFeedback = updateImageFeedback(word, 'wrong', standing);
  assert.deepEqual(word.imageFeedback.goodUrls, []);
});

test('photo identity normalization preserves query-addressed images on other hosts', () => {
  const original = sense('query-image-identity');
  const rejected = { url: 'https://photos.example/image?id=fox-standing', title: 'Fox standing across meadow', source: 'Pexels' };
  const alternative = { url: 'https://photos.example/image?id=fox-running', title: 'Fox running across meadow', source: 'Pexels' };
  const word = { ...original, imageFeedback: updateImageFeedback(original, 'wrong', rejected) };
  assert.deepEqual(rankImageCandidates([rejected, alternative], word, { concepts: ['fox running meadow'] }), [alternative]);
});

test('approving a resized photo overrides a legacy rejection of that photo', () => {
  const original = { ...sense('legacy-rejection'), imageRejectedUrls: ['https://images.pexels.com/photos/73103/old.jpeg?w=100'] };
  const photo = { url: 'https://images.pexels.com/photos/73103/new.jpeg?w=400', title: 'Person balancing stones', source: 'Pexels' };
  const word = { ...original, imageFeedback: updateImageFeedback(original, 'good', photo) };
  assert.equal(rankImageCandidates([photo], word, { concepts: ['person balancing stones'] }).length, 1);
});

test('search keeps the exact prompt after rejecting one of its results', async () => {
  const prompt = 'fox running through unique rejection meadow';
  const original = { word: 'run', partOfSpeech: 'verb', definition: 'Move quickly on foot.' };
  const rejected = { url: 'https://images.pexels.com/photos/73104/preview.jpeg?w=200', searchQuery: prompt };
  const word = { ...original, imageFeedback: updateImageFeedback(original, 'wrong', rejected) };
  const requested = [];
  const results = await findRelevantImages(word, {
    aiScenes: false, validateImages: false, provider: 'pexels', pexelsApiKey: 'test-rejection-key', extraQueries: [prompt], onlyExtraQueries: true,
    fetchImpl: async value => {
      const request = new URL(value);
      if (request.hostname !== 'api.pexels.com') return { ok: true, json: async () => ({}) };
      requested.push(request.searchParams.get('query'));
      return { ok: true, json: async () => ({ photos: [
        { id: 73104, url: 'https://www.pexels.com/photo/standing-fox-73104/', alt: 'Fox standing still in unique rejection meadow', src: { medium: 'https://images.pexels.com/photos/73104/preview.jpeg?w=500' } },
        { id: 73105, url: 'https://www.pexels.com/photo/running-fox-73105/', alt: 'Fox running through unique rejection meadow', src: { medium: 'https://images.pexels.com/photos/73105/preview.jpeg?w=500' } }
      ] }) };
    }
  });
  assert.deepEqual(requested, [prompt]);
  assert.deepEqual(results.map(image => image.sourceUrl), ['https://www.pexels.com/photo/running-fox-73105/']);
});

test('search ranks the whole bounded candidate pool before choosing a small result set and avoids needless pixel loads', async () => {
  let loads = 0;
  const images = Array.from({ length: 40 }, (_, index) => ({ title: index === 2 ? 'Unique pool river bank scene' : `River bank ${index}`, thumbnail: `https://pool.test/${index}.jpg`, foreign_landing_url: `https://pool.test/source/${index}`, tags: ['river', 'bank'] }));
  const found = await findRelevantImages(sense('widepool'), { aiScenes: false, extraQueries: ['unique pool river bank scene'], onlyExtraQueries: true, limit: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: images }) }), loadImage: async () => { loads++; return true; }
  });
  assert.equal(found[0].url, 'https://pool.test/2.jpg');
  assert.ok(loads <= 2);
});

test('Pexels exposes medium previews rather than full-size image URLs', async () => {
  const found = await findPexelsImages('medium-preview-optimization', 'key', async () => ({ ok: true, json: async () => ({ photos: [{ url: 'https://pexels.test/source', alt: 'Medium preview', src: { medium: 'https://pexels.test/medium.jpg', large: 'https://pexels.test/large.jpg' } }] }) }));
  assert.equal(found[0].url, 'https://pexels.test/medium.jpg');
  assert.equal(found[0].thumbnailUrl, found[0].url);
});

test('explicitly disabled scene generation makes no new AI requests, even with a Gemini key', async () => {
  const saved = storage();
  const word = sense('no-paid-scenes');
  let sceneCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) { sceneCalls++; assert.fail('Normal image searches must not call Gemini'); }
    return { ok: true, json: async () => ({ results: [] }) };
  };
  const [prepared] = await prepareImageScenes([word], { aiScenes: false, storage: saved, fetchImpl });
  assert.equal(prepared.imageScenes, undefined);
  await findRelevantImages(prepared, { aiScenes: false, storage: saved, fetchImpl, validateImages: false });
  assert.equal(sceneCalls, 0);
});

test('image evaluation never uploads photographs even with a key and the old rerank flag', async () => {
  const requests = [];
  const found = await findRelevantImages(sense('no-image-uploads'), {
    storage: storage(), aiScenes: false, semanticRerank: true,
    onlyExtraQueries: true, extraQueries: ['person carrying heavy bags'],
    provider: 'pexels', pexelsApiKey: 'no-image-uploads-key', validateImages: false,
    fetchImpl: async (value, options) => {
      const url = new URL(value); requests.push(url);
      assert.equal(url.hostname, 'api.pexels.com');
      assert.equal(options?.body, undefined);
      return { ok: true, json: async () => ({ photos: Array.from({ length: 3 }, (_, i) => ({
        url: `https://no-image-upload.test/${i}`, alt: 'A person carrying bags', src: { medium: `https://no-image-upload.test/${i}.jpg` }
      })) }) };
    }
  });
  assert.equal(found.length, 3);
  assert.equal(requests.length, 1);
});

test('prepared meaning prompts drive image searches without another AI call or raw definition fallbacks', async () => {
  const saved = storage();
  const words = [
    { word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.' },
    { word: 'bank', partOfSpeech: 'noun', definition: 'A financial institution that holds money.' }
  ];
  const scenes = ['fisherman resting beside a winding river', 'customer depositing cash with office teller'];
  let calls = 0;
  const prepared = await prepareImageScenes(words, { storage: saved, fetchImpl: async (_url, options) => {
    calls++;
    const items = requestedSenses(options);
    assert.deepEqual(items[0].otherDefinitions, [words[1].definition]);
    assert.deepEqual(items[1].otherDefinitions, [words[0].definition]);
    // The mapping must follow IDs even if the model reverses its response.
    return response({ items: items.map((item, index) => ({ id: item.id, scenes: [scenes[index], index === 0 ? 'children skipping stones beside a winding river' : 'teller handing coins across a service counter'] })).reverse() });
  } });
  assert.equal(calls, 1);
  assert.deepEqual(prepared.map(word => word.imageScenes.scenes[0]), scenes);
  for (const [index, word] of prepared.entries()) {
    const queries = [];
    const fetchImpl = async url => {
      assert.equal(String(url).includes('generativelanguage.googleapis.com'), false);
      const parsed = new URL(url);
      queries.push(parsed.searchParams.get('query') || parsed.searchParams.get('q') || parsed.searchParams.get('gsrsearch'));
      return { ok: true, json: async () => ({}) };
    };
    await findRelevantImages(word, { aiScenes: false, storage: saved, fetchImpl, validateImages: false });
    // Also cover a renderer that only has the persisted scene cache.
    await findRelevantImages(words[index], { aiScenes: false, storage: saved, fetchImpl, validateImages: false });
    assert.ok(queries.length > 0);
    assert.deepEqual([...new Set(queries)], prepared[index].imageScenes.scenes.map(compactVisualSearchQuery));
  }
});

test('generation receives meaning restrictions and retries duplicate depictions for sibling meanings', async () => {
  const saved = storage();
  const words = [
    { word: 'sceneambiguity', partOfSpeech: 'noun', sourceDefinition: 'A notice or sign placed at an entrance.', definition: 'A posted message.', usageNote: 'A physical object.', labels: ['literal'] },
    { word: 'sceneambiguity', partOfSpeech: 'noun', definition: 'A supporting structure beneath a machine.' }
  ];
  const scenes = ['person mounting wooden notice beside entrance', 'mechanic fitting metal support beneath heavy machine'];
  const alternatives = ['worker hanging a warning board outside doorway', 'engineer adjusting steel platform below a motor'];
  const batches = [];
  const prepared = await prepareImageScenes(words, { storage: saved, fetchImpl: async (_url, options) => {
    const items = requestedSenses(options); batches.push(items);
    if (batches.length === 1) return response({ items: items.map(item => ({ id: item.id, scenes: [scenes[0], alternatives[0]] })) });
    return response({ items: [{ id: items[0].id, scenes: [scenes[1], alternatives[1]] }] });
  } });
  assert.equal(batches.length, 2);
  assert.equal(batches[0][0].definition, words[0].sourceDefinition);
  assert.equal(batches[0][0].learnerDefinition, words[0].definition);
  assert.equal(batches[0][0].usageNote, words[0].usageNote);
  assert.deepEqual(batches[0][0].labels, ['literal']);
  assert.deepEqual(batches[1][0].avoidScenes, [scenes[0], alternatives[0]]);
  assert.deepEqual(prepared.map(word => word.imageScenes.scenes[0]), scenes);
});

test('longer prompts keep final disambiguating details and search retains actions and negation', () => {
  const word = sense('longscene');
  const longScene = 'a worker removing a wooden notice from the entrance to a closed shop';
  assert.equal(compactGeneratedScene(longScene), longScene);
  assert.equal(isConcreteVisualScene(longScene, word), true);
  assert.equal(isConcreteVisualScene(`${longScene} while another worker carefully watches from the busy street`, word), false);
  assert.notEqual(compactVisualSearchQuery('person plugging cable into wall socket'), compactVisualSearchQuery('person unplugging cable from wall socket'));
  assert.match(compactVisualSearchQuery('person refusing money without touching offered cash'), /without/);
  assert.match(compactVisualSearchQuery(longScene), /closed shop$/);
});

test('skipping images aborts provider requests and an already-cancelled search makes no requests', async () => {
  const controller = new AbortController();
  const signals = [];
  const pending = findRelevantImages(sense('cancel-providers'), {
    aiScenes: false, signal: controller.signal,
    extraQueries: ['cancel provider photo probe'], onlyExtraQueries: true,
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    }
  });
  controller.abort();
  assert.deepEqual(await pending, []);
  assert.ok(signals.length > 0);
  assert.ok(signals.every(signal => signal.aborted));
  assert.deepEqual(await findRelevantImages(sense('already-cancelled'), { signal: controller.signal, fetchImpl: () => assert.fail('No cancelled network work') }), []);
});

test('one-scene and duplicate-only generations are retried, never persisted as a complete scene set', async () => {
  const saved = storage(); const word = sense('two-required'); let calls = 0;
  const [prepared] = await prepareImageScenes([word], { storage: saved, fetchImpl: async () => {
    calls++;
    return response({ scenes: calls === 1 ? [scene, scene.toUpperCase()] : pair });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(prepared.imageScenes.scenes, pair);
  assert.equal(imageSceneRecordFor({ ...sense('invalid-single'), imageScenes: { ...prepared.imageScenes,
    fingerprint: imageSenseFingerprint(sense('invalid-single')), scenes: [scene] } }, { storage: saved }), null);
});

test('all prepared prompts contribute three unique candidates within the reduced scoring pool', async () => {
  const saved = storage(); const scenes = [...pair, 'child arranging pebbles beside a garden pond'];
  const [word] = await prepareImageScenes([sense('three-per-scene')], { storage: saved, fetchImpl: async () => response({ scenes }) });
  const requests = [];
  const found = await findRelevantImages(word, { storage: saved, aiScenes: false, provider: 'pexels', pexelsApiKey: 'synthetic', limit: 45, validateImages: false,
    fetchImpl: async value => {
      const url = new URL(value); requests.push(url);
      assert.equal(url.hostname, 'api.pexels.com', 'full prompt pools need no fallback');
      assert.equal(url.searchParams.get('per_page'), '3');
      const index = scenes.map(compactVisualSearchQuery).indexOf(url.searchParams.get('query'));
      assert.ok(index >= 0);
      return { ok: true, json: async () => ({ photos: Array.from({ length: 30 }, (_, i) => ({
        url: `https://pexels.test/three/${index}/${i}`, alt: `${scenes[index]} frame ${i}`,
        src: { medium: `https://photos.test/three/${index}/${i}.jpg` }
      })) }) };
    }
  });
  assert.equal(requests.length, 3);
  assert.equal(found.length, 9);
  assert.deepEqual(scenes.map(scene => found.filter(image => image.visualScene === scene).length), [3, 3, 3]);
});

test('a full first prompt does not suppress fallback searches for an empty second prompt', async () => {
  const queries = ['first prompt unique stock sample', 'second prompt empty stock sample']; const requested = [];
  const results = await findRelevantImages(sense('per-scene-fallback'), { aiScenes: false, onlyExtraQueries: true, extraQueries: queries,
    provider: 'pexels', pexelsApiKey: 'synthetic', limit: 45, validateImages: false,
    fetchImpl: async value => {
      const url = new URL(value); const query = url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('gsrsearch');
      requested.push({ host: url.hostname, query });
      if (url.hostname === 'api.pexels.com') return { ok: true, json: async () => ({ photos: query === queries[0] ? Array.from({ length: 40 }, (_, i) => ({
        url: `https://pexels.test/fallback/${i}`, alt: `${queries[0]} frame ${i}`, src: { medium: `https://photos.test/fallback/${i}.jpg` }
      })) : [] }) };
      return { ok: true, json: async () => url.hostname === 'api.openverse.org' ? { results: Array.from({ length: 15 }, (_, i) => ({
        thumbnail: `https://fallback.test/${i}.jpg`, foreign_landing_url: `https://fallback.test/source/${i}`, title: `${queries[1]} frame ${i}`
      })) } : {} };
    }
  });
  assert.equal(results.length, 6);
  assert.ok(requested.some(r => r.host === 'api.openverse.org' && r.query === queries[1]));
  assert.ok(requested.filter(r => r.host !== 'api.pexels.com').every(r => r.query === queries[1]));
});

test('different stock photos with identical alt captions remain eligible across prompts', async () => {
  const query = 'identical caption unique stock photos';
  const results = await findRelevantImages(sense('stock-captions'), { aiScenes: false, onlyExtraQueries: true, extraQueries: [query],
    provider: 'pexels', pexelsApiKey: 'synthetic', limit: 45, validateImages: false,
    fetchImpl: async value => {
      assert.equal(new URL(value).hostname, 'api.pexels.com');
      return { ok: true, json: async () => ({ photos: Array.from({ length: 15 }, (_, i) => ({
        url: `https://pexels.test/same-caption/${i}`, alt: 'A person outside', src: { medium: `https://photos.test/same-caption/${i}.jpg` }
      })) }) };
    }
  });
  assert.equal(results.length, 3);
});

test('Gemini scene prompt enforces prominent foreground framing without 6-class taxonomy overhead', async () => {
  const saved = storage();
  const word = sense('prominent-contract');
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.doesNotMatch(prompt, /focus_classes/);
    assert.match(prompt, /Distant, tiny, background-only or incidental targets are unsuitable/);
    return response({ scenes: pair, contrasts: ['lone stone resting on dry sand'] });
  };
  const [prepared] = await prepareImageScenes([word], { storage: saved, fetchImpl });
  assert.equal(prepared.imageScenes.focus, undefined);
  assert.deepEqual(prepared.imageScenes.contrasts, ['lone stone resting on dry sand']);
  const { DriveSyncService, MemoryStorage } = await import('../js/services/driveSync.js');
  const service = new DriveSyncService(new MemoryStorage());
  const stored = service.addWord(prepared);
  assert.equal(stored.imageScenes.focus, undefined);
  const [cached] = await prepareImageScenes([{ ...word, imageScenes: stored.imageScenes }], { storage: saved, fetchImpl });
  assert.equal(cached.imageScenes.focus, undefined);
  assert.equal(calls, 1);
  const { imageClipPrompts } = await import('../js/services/imageLearning.js');
  assert.ok(imageClipPrompts(cached).texts.every(text => !text.includes('focus_classes')));
});

test('cached Gemini scenes remain usable without a key, without generating new descriptions', async () => {
  const saved = storage();
  const word = { word: 'in front of', partOfSpeech: 'preposition', definition: 'Positioned ahead of another object.' };
  const [prepared] = await prepareImageScenes([word], { storage: saved, fetchImpl: async () => response({
    scenes: ['person standing before a parked bus', 'cyclist waiting ahead of a delivery truck']
  }) });
  assert.equal(prepared.imageScenes.scenes.length, 2);
  saved.setItem('keepvocab_gemini_live_key_v1', '');
  const [keyless] = await prepareImageScenes([prepared], { storage: saved, fetchImpl: () => assert.fail('No Gemini request without a key') });
  assert.deepEqual(keyless.imageScenes.scenes, prepared.imageScenes.scenes);
  assert.equal(prepared.imageScenes.scenes.length, 2, 'Do not mutate the supplied or cached scene record');
  const queries = [];
  await findRelevantImages(prepared, { storage: saved, validateImages: false, provider: 'pexels', pexelsApiKey: 'synthetic-pexels-key',
    fetchImpl: async value => {
      const url = new URL(value);
      assert.ok(!url.hostname.includes('generativelanguage'), 'No hidden Gemini request');
      queries.push(url.searchParams.get('query') || url.searchParams.get('q') || url.searchParams.get('gsrsearch'));
      return { ok: true, json: async () => ({ photos: [], results: [], query: { pages: {} }, collection: { items: [] } }) };
    }
  });
  assert.equal(queries.length, 10);
  assert.deepEqual([...new Set(queries)], prepared.imageScenes.scenes.map(compactVisualSearchQuery));
});

test('without Gemini scenes, word and exact meaning each receive three candidate slots before ranking',async()=>{
 const word={word:'balancedretrievalprobe',partOfSpeech:'noun',definition:'The activity of imparting and acquiring skills.'};
 for(const saved of [storage(),{getItem:()=>null,setItem:()=>{}}]){
  const requests=[];
  const results=await findRelevantImages(word,{storage:saved,aiScenes:false,provider:'pexels',pexelsApiKey:'synthetic-balance-key',limit:45,validateImages:false,refresh:true,
   fetchImpl:async value=>{const url=new URL(value);assert.equal(url.hostname,'api.pexels.com');requests.push(url.searchParams.get('query'));assert.equal(url.searchParams.get('per_page'),'3');const branch=url.searchParams.get('query')===word.word?'word':'meaning';return{ok:true,json:async()=>({photos:Array.from({length:15},(_,i)=>({id:`${branch}-${i}`,url:`https://balance.test/${branch}/${i}`,alt:`${url.searchParams.get('query')} frame ${i}`,src:{medium:`https://balance.test/${branch}/${i}.jpg`}}))})};}
  });
  if(requests.length) assert.deepEqual([...new Set(requests)],['balancedretrievalprobe','the activity of imparting and acquiring skills']);
  assert.equal(results.length,6);
  assert.equal(results.filter(r=>r.retrievalQueryType==='word').length,3);
  assert.equal(results.filter(r=>r.retrievalQueryType==='meaning').length,3);
 }
});

test('more than three prompts share nine slots and keep provider pagination stable', async () => {
  const queries = ['first', 'second', 'third', 'fourth'].map(name => `four prompt budget scene ${name}`);
  const requests = [];
  const search = page => findRelevantImages(sense('four-prompts'), {
    aiScenes: false, onlyExtraQueries: true, extraQueries: queries, page, limit: 100,
    provider: 'pexels', pexelsApiKey: 'four-prompt-key', validateImages: false,
    fetchImpl: async value => {
      const url = new URL(value); requests.push(url);
      assert.equal(url.hostname, 'api.pexels.com');
      assert.equal(url.searchParams.get('per_page'), '3');
      const scene = queries.indexOf(url.searchParams.get('query'));
      return { ok: true, json: async () => ({ photos: Array.from({ length: 3 }, (_, i) => ({
        url: `https://four-prompts.test/${page}/${scene}/${i}`, alt: 'Different photographs sharing an alt caption',
        src: { medium: `https://four-prompts.test/${page}/${scene}/${i}.jpg` }
      })) }) };
    }
  });
  const first = await search(1), second = await search(2);
  const counts = images => queries.map(query => images.filter(image => image.visualScene === query).length);
  assert.deepEqual(counts(first), [3, 2, 2, 2]);
  assert.deepEqual(counts(second), [2, 3, 2, 2]);
  assert.equal(requests.length, 8, 'a full per-prompt quota starts no catalog fallback');
});

test('more than nine prompts rotate the active searches without exceeding nine evaluations', async () => {
  const queries = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].map(name => `prompt rotation scene ${name}`);
  for (const page of [1, 2]) {
    const requests = [];
    const found = await findRelevantImages(sense('ten-prompts'), {
      aiScenes: false, onlyExtraQueries: true, extraQueries: queries, page, limit: 100,
      provider: 'pexels', pexelsApiKey: 'ten-prompt-key', validateImages: false,
      fetchImpl: async value => {
        const url = new URL(value); requests.push(url.searchParams.get('query'));
        assert.equal(url.hostname, 'api.pexels.com');
        assert.equal(url.searchParams.get('per_page'), '1');
        const scene = queries.indexOf(url.searchParams.get('query'));
        return { ok: true, json: async () => ({ photos: [{
          url: `https://ten-prompts.test/${page}/${scene}`, alt: 'Prominent subject',
          src: { medium: `https://ten-prompts.test/${page}/${scene}.jpg` }
        }] }) };
      }
    });
    assert.equal(found.length, 9);
    assert.equal(requests.length, 9);
    assert.ok(!requests.includes(queries[page === 1 ? 9 : 0]));
    assert.equal(new Set(found.map(image => image.visualScene)).size, 9);
  }
});

test('equivalent provider queries share one quota and one request', async () => {
  let requests = 0;
  const found = await findRelevantImages(sense('query-dedup'), {
    aiScenes: false, onlyExtraQueries: true,
    extraQueries: ['a person lifting a heavy box', 'person lifting heavy box'],
    provider: 'pexels', pexelsApiKey: 'query-dedup-key', limit: 9, validateImages: false,
    fetchImpl: async value => {
      const url = new URL(value); requests++;
      assert.equal(url.hostname, 'api.pexels.com');
      assert.equal(url.searchParams.get('query'), 'person lifting heavy box');
      return { ok: true, json: async () => ({ photos: Array.from({ length: 3 }, (_, i) => ({
        url: `https://query-dedup.test/${i}`, alt: 'A person lifting a box', src: { medium: `https://query-dedup.test/${i}.jpg` }
      })) }) };
    }
  });
  assert.equal(found.length, 3);
  assert.equal(requests, 1);
});
