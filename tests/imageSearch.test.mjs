import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVisualSceneDescriptions, buildVisualSearchQueries, canonicalVisualTerm, compactGeneratedScene, compactVisualSearchQuery, filterLoadableImages, findLibraryOfCongressImages, findNasaImages, findPexelsImages, findRelevantImages, findWikimediaImages, generateVisualScenesWithGemini, getImageProviderBackupRecord, getImageProviderSettings, imageFeedbackFor, isConcreteVisualScene, isPhysicalObjectSense, rankOpenverseImages, restoreImageProviderBackupRecord, saveImageProviderSettings, updateImageFeedback } from '../js/services/imageSearch.js';

test('candidate validation limits concurrent loads, retries failures, and preserves ranking order', async () => {
  const candidates = ['first', 'retry', 'broken', 'last'].map(name => ({ url: `https://images.example/${name}.jpg`, title: name }));
  let active = 0;
  let maximumActive = 0;
  const attempts = new Map();
  const loaded = await filterLoadableImages(candidates, {
    limit: 3,
    concurrency: 2,
    retryDelayMs: 1,
    loadImage: async url => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const count = (attempts.get(url) || 0) + 1;
      attempts.set(url, count);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      if (url.includes('/broken.')) return false;
      if (url.includes('/retry.')) return count > 1;
      return true;
    }
  });

  assert.equal(maximumActive, 2);
  assert.equal(attempts.get(candidates[1].url), 2);
  assert.equal(attempts.get(candidates[2].url), 2);
  assert.deepEqual(loaded.map(image => image.title), ['first', 'retry', 'last']);
});

test('candidate validation is a no-op outside a browser when no loader is provided', async () => {
  const candidates = [{ url: 'https://images.example/one.jpg' }];
  assert.deepEqual(await filterLoadableImages(candidates), candidates);
});

const runningWord = {
  word: 'to run',
  partOfSpeech: 'verb',
  definition: 'move at a speed faster than a walk'
};

test('image searches derive visible concepts from the selected definition', () => {
  assert.equal(canonicalVisualTerm('to run'), 'run');
  const queries = buildVisualSearchQueries(runningWord);
  assert.ok(queries.some(query => query.includes('athlete sprinting')));
  assert.ok(queries.some(query => query.includes('run move speed faster')));
  assert.equal(queries.some(query => /phrasal|grammar|worksheet/.test(query)), false);
});

test('image ranking removes text-heavy grammar diagrams and requires the whole visual concept', () => {
  const ranked = rankOpenverseImages([
    { title: 'Phrasal verb trees worksheet.png', tags: ['people', 'running'] },
    { title: 'A rainy evening.jpg', tags: ['running water'] },
    { title: 'People running in the park.jpg', tags: ['people', 'running'], category: 'photograph' }
  ], 'people running');

  assert.deepEqual(ranked.map(image => image.title), ['People running in the park.jpg']);
});

test('person meanings become visible human scenes instead of raw-spelling searches', () => {
  const queries = buildVisualSearchQueries({
    word: 'idiot',
    partOfSpeech: 'noun',
    definition: 'A stupid or foolish person.'
  });
  assert.ok(queries.some(query => /person/.test(query)));
  assert.match(queries[0], /confused person|obvious mistake/);
  assert.notEqual(queries[0], 'idiot');
});

test('image suggestions remove duplicate variants of the same titled image', () => {
  const ranked = rankOpenverseImages([
    { title: 'Silly face group photo', tags: ['silly', 'face'] },
    { title: 'Silly face group photo - op5', tags: ['silly', 'face'] },
    { title: 'Giraffe making a silly face', tags: ['silly', 'face'] }
  ], 'silly face');
  assert.deepEqual(ranked.map(image => image.title), ['Silly face group photo', 'Giraffe making a silly face']);
});

test('dictionary examples never influence automatic image concepts', () => {
  const withExample = buildVisualSearchQueries({
    word: 'ephemeral',
    partOfSpeech: 'adjective',
    definition: 'lasting for a very short time',
    example: 'The beauty of cherry blossoms is ephemeral.'
  });
  const withoutExample = buildVisualSearchQueries({
    word: 'ephemeral',
    partOfSpeech: 'adjective',
    definition: 'lasting for a very short time',
    example: 'A completely different online dictionary context about city traffic.'
  });
  assert.deepEqual(withExample, withoutExample);
  assert.equal(withExample.some(query => /cherry|blossom|traffic|city/.test(query)), false);
});

test('different senses of the same spelling receive different visual concepts', () => {
  const louder = buildVisualSearchQueries({ word: 'augment', partOfSpeech: 'verb', definition: 'To increase; to make larger or supplement.' });
  const musical = buildVisualSearchQueries({ word: 'augment', partOfSpeech: 'verb', definition: 'To slow the tempo or meter for a dramatic passage.' });
  const biological = buildVisualSearchQueries({ word: 'proliferation', partOfSpeech: 'noun', definition: 'The process by which an organism produces others of its kind; breeding and reproduction.' });

  assert.match(louder[0], /inflating|grows/);
  assert.match(musical[0], /conductor|orchestra/);
  assert.match(biological[0], /organism|produces|breeding/);
  assert.notEqual(louder[0], musical[0]);
});

test('Gemini turns the exact word sense into concise public-catalog search scenes when configured', async () => {
  const values = new Map([['keepvocab_gemini_live_key_v1', 'AIza-test-key-for-image-scenes-123456789']]);
  const storage = { getItem: key => values.get(key) || null };
  let prompt = '';
  const scenes = await generateVisualScenesWithGemini(
    { word: 'bank', partOfSpeech: 'noun', definition: 'The land beside a river.' },
    {
      storage,
      fetchImpl: async (_url, options) => {
        prompt = JSON.parse(options.body).contents[0].parts[0].text;
        return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: '{"scenes":["family relaxing beside grassy river at sunset","children walking along shallow river shoreline","fisherman standing beside muddy river under trees"]}' }] } }] }; } };
      }
    }
  );

  assert.match(prompt, /Target word: bank/);
  assert.match(prompt, /Exact selected definition: The land beside a river/);
  assert.match(prompt, /Exactly 5-7 concrete words/);
  assert.match(prompt, /If it is a physical object, do not invent a scene/);
  assert.match(prompt, /such as wrench/);
  assert.match(prompt, /such as laptops/);
  assert.match(prompt, /worker cutting a metal sheet/);
  assert.deepEqual(scenes, ['family relaxing beside grassy river at sunset', 'children walking along shallow river shoreline', 'fisherman standing beside muddy river under trees']);
});

test('physical object meanings search the object name without inventing a scene', async () => {
  const values = new Map([['keepvocab_gemini_live_key_v1', 'AIza-test-key-for-object-query-123456789']]);
  const storage = { getItem: key => values.get(key) || null };
  const wrench = { word: 'wrench', partOfSpeech: 'noun', definition: 'A metal tool used for gripping and turning nuts and bolts.' };
  const laptops = { word: 'laptops', partOfSpeech: 'noun', definition: 'Plural of laptop; portable computers small enough to use on the lap.' };
  const scenes = await generateVisualScenesWithGemini(wrench, {
    storage,
    fetchImpl: async () => ({ ok: true, async json() { return { candidates: [{ content: { parts: [{ text: '{"scenes":["wrench"]}' }] } }] }; } })
  });

  assert.equal(isPhysicalObjectSense(wrench), true);
  assert.equal(isPhysicalObjectSense(laptops), true);
  assert.equal(isConcreteVisualScene('wrench', wrench), true);
  assert.equal(isConcreteVisualScene('conquest', { word: 'conquest', partOfSpeech: 'noun', definition: 'A victory gained through force.' }), false);
  assert.deepEqual(scenes, ['wrench']);
  assert.equal(buildVisualSearchQueries(wrench)[0], 'wrench');
  assert.equal(buildVisualSearchQueries(laptops)[0], 'laptops');
});

test('AI visual descriptions are mechanically capped at seven useful words', () => {
  assert.equal(
    compactGeneratedScene('A family relaxing on the grassy river edge at sunset'),
    'family relaxing grassy river edge sunset'
  );
});

test('physical detachment uses separation scenes rather than destructive cutting', () => {
  const scenes = buildVisualSceneDescriptions({
    word: 'detachment',
    partOfSpeech: 'noun',
    definition: 'The action or process of detaching or separating something.'
  });

  assert.deepEqual(scenes, [
    'carabiner unclipped from a climbing rope',
    'mechanic removing a wheel from a bicycle',
    'person unplugging a cable from a wall socket'
  ]);
  assert.equal(scenes.some(scene => /cut|sheet/.test(scene)), false);
});

test('visual-scene validation rejects word repetition and clipped definitions', () => {
  const conquest = { word: 'conquest', definition: 'A victory gained through force.' };
  assert.equal(isConcreteVisualScene('conquest victory gained through force', conquest), false);
  assert.equal(isConcreteVisualScene('victory gained through military force', conquest), false);
  assert.equal(isConcreteVisualScene('soldier planting a flag on a captured hilltop', conquest), false);
  assert.equal(isConcreteVisualScene('soldier planting flag on captured hilltop', conquest), true);
  assert.equal(compactVisualSearchQuery('soldier planting a flag on a captured hilltop'), 'soldier flag hilltop');
  assert.deepEqual(buildVisualSceneDescriptions(conquest), [
    'soldier planting flag on captured hilltop',
    'victorious army entering a captured fortress',
    'leader overlooking territory after a battle'
  ]);
});

test('uncurated verb senses include definition words instead of searching spelling alone', () => {
  const movement = buildVisualSearchQueries({ word: 'run', partOfSpeech: 'verb', definition: 'Move quickly on foot.' });
  const business = buildVisualSearchQueries({ word: 'run', partOfSpeech: 'verb', definition: 'Manage and operate a business.' });

  assert.match(movement[0], /athlete sprinting/);
  assert.match(business[0], /manager directing employees/);
  assert.notEqual(movement[0], business[0]);
});

test('a saved custom visual interpretation is searched before generated concepts', () => {
  const queries = buildVisualSearchQueries({
    word: 'augment',
    partOfSpeech: 'verb',
    definition: 'To slow the tempo or meter for a dramatic passage.',
    imageCustomConcept: 'conductor slowing an orchestra'
  });

  assert.equal(queries[0], 'conductor slowing an orchestra');
  assert.ok(queries.some(query => /tempo|meter/.test(query)));
});

test('an active custom interpretation can suppress unrelated generated fallbacks', async () => {
  const requestedQueries = [];
  const fetchImpl = async url => {
    const request = new URL(url);
    if (request.hostname === 'api.pexels.com') requestedQueries.push(request.searchParams.get('query'));
    return {
      ok: true,
      async json() {
        return { photos: [{
          url: 'https://www.pexels.com/photo/77/',
          photographer: 'Test',
          alt: 'Soap bubble popping in sunlight',
          src: { large: 'https://images.pexels.com/photos/77/large.jpeg' }
        }] };
      }
    };
  };

  const results = await findRelevantImages(
    { word: 'ephemeral', definition: 'Lasting for a very short time.' },
    {
      provider: 'pexels',
      pexelsApiKey: 'key',
      extraQueries: ['soap bubble popping in sunlight'],
      onlyExtraQueries: true,
      fetchImpl,
      limit: 1
    }
  );

  assert.deepEqual(requestedQueries, ['soap bubble popping']);
  assert.equal(results[0].searchQuery, 'soap bubble popping');
});

test('already attached image URLs are excluded from new suggestions', async () => {
  const usedUrl = 'https://images.example/used.jpg';
  const freshUrl = 'https://images.example/fresh.jpg';
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { results: [
        { title: 'Inflating balloon one', thumbnail: usedUrl, foreign_landing_url: 'https://source.example/used', tags: [{ name: 'inflating' }, { name: 'balloon' }], category: 'photograph' },
        { title: 'Inflating balloon two', thumbnail: freshUrl, foreign_landing_url: 'https://source.example/fresh', tags: [{ name: 'inflating' }, { name: 'balloon' }], category: 'photograph' }
      ] };
    }
  });
  const results = await findRelevantImages(
    { word: 'augment', partOfSpeech: 'verb', definition: 'To increase; to make larger or supplement.' },
    { fetchImpl, excludeUrls: [usedUrl], extraQueries: ['inflating balloon'], onlyExtraQueries: true }
  );

  assert.equal(results.some(image => image.url === usedUrl), false);
  assert.equal(results.some(image => image.url === freshUrl), true);
});

test('Pexels requests use the exact visual concept and preserve attribution metadata', async () => {
  let requestedUrl = '';
  let authorization = '';
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    authorization = options.headers.Authorization;
    return {
      ok: true,
      async json() {
        return { photos: [{
          id: 42,
          width: 1200,
          height: 800,
          url: 'https://www.pexels.com/photo/42/',
          photographer: 'A Photographer',
          alt: 'A person inflating a red balloon',
          src: { large: 'https://images.pexels.com/photos/42/large.jpeg' }
        }] };
      }
    };
  };

  const results = await findPexelsImages('inflating balloon', 'device-key', fetchImpl);
  const request = new URL(requestedUrl);
  assert.equal(request.searchParams.get('query'), 'inflating balloon');
  assert.equal(authorization, 'device-key');
  assert.equal(results[0].source, 'Pexels');
  assert.equal(results[0].attribution, 'A Photographer via Pexels');
  assert.equal(results[0].sourceUrl, 'https://www.pexels.com/photo/42/');
});

test('Wikimedia Commons provides keyless image results with attribution metadata', async () => {
  let requestedUrl = '';
  const results = await findWikimediaImages('people running', async url => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return { query: { pages: { 42: {
          title: 'File:People running in a city park.jpg',
          imageinfo: [{
            thumburl: 'https://upload.wikimedia.org/running-thumb.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:People_running.jpg',
            thumbwidth: 1200,
            thumbheight: 800,
            mime: 'image/jpeg',
            extmetadata: { Artist: { value: '<b>A Photographer</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } }
          }]
        } } } };
      }
    };
  });
  const request = new URL(requestedUrl);
  assert.equal(request.searchParams.get('origin'), '*');
  assert.equal(request.searchParams.get('gsrnamespace'), '6');
  assert.equal(results[0].source, 'Wikimedia Commons');
  assert.equal(results[0].attribution, 'A Photographer via Wikimedia Commons');
  assert.equal(results[0].license, 'CC BY-SA 4.0');
});

test('Wikimedia Commons rejects PDFs and other non-raster search results', async () => {
  const results = await findWikimediaImages('unique-pdf-filter-query', async () => ({
    ok: true,
    async json() {
      return { query: { pages: {
        1: { title: 'File:Vocabulary handbook.pdf', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/handbook.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Handbook.pdf', mime: 'application/pdf' }] },
        2: { title: 'File:Vocabulary learner.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/learner.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Learner.jpg', mime: 'image/jpeg', extmetadata: {} }] }
      } } };
    }
  }));
  assert.deepEqual(results.map(image => image.title), ['Vocabulary learner.jpg']);
});

test('Library of Congress adds a third keyless photo catalog with source metadata', async () => {
  let requestedUrl = '';
  const results = await findLibraryOfCongressImages('bank customer money', async url => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return { results: [{
          id: 'http://www.loc.gov/item/123/',
          title: 'Customer depositing money at a bank counter',
          image_url: ['https://tile.loc.gov/thumb.jpg', 'https://tile.loc.gov/medium.jpg'],
          contributor: ['Example photographer'],
          subject: ['banks', 'customers', 'money'],
          item: { rights_advisory: 'No known restrictions on publication.' }
        }] };
      }
    };
  });
  const request = new URL(requestedUrl);
  assert.equal(request.origin, 'https://www.loc.gov');
  assert.equal(request.pathname, '/photos/');
  assert.equal(request.searchParams.get('q'), 'bank customer money');
  assert.equal(request.searchParams.get('fo'), 'json');
  assert.equal(results[0].source, 'Library of Congress');
  assert.equal(results[0].sourceUrl, 'https://www.loc.gov/item/123/');
  assert.match(results[0].attribution, /Example photographer/);
});

test('NASA Images adds a fourth keyless catalog with its official source page', async () => {
  let requestedUrl = '';
  const results = await findNasaImages('astronaut planting flag moon', async url => {
    requestedUrl = url;
    return {
      ok: true,
      async json() {
        return { collection: { items: [{
          data: [{ nasa_id: 'AS11-40-5875', title: 'Astronaut planting a flag on the Moon', center: 'JSC', keywords: ['astronaut', 'flag', 'moon'] }],
          links: [{ href: 'https://images-assets.nasa.gov/image/AS11-40-5875/preview.jpg', render: 'image' }]
        }] } };
      }
    };
  });
  const request = new URL(requestedUrl);
  assert.equal(request.origin, 'https://images-api.nasa.gov');
  assert.equal(request.searchParams.get('media_type'), 'image');
  assert.equal(results[0].source, 'NASA Images');
  assert.equal(results[0].sourceUrl, 'https://images.nasa.gov/details/AS11-40-5875');
  assert.match(results[0].attribution, /JSC via NASA/);
});

test('all keyless catalogs run concurrently and ten results are mixed by source', { timeout: 2000 }, async () => {
  const concept = 'soldier planting flag captured hilltop';
  let started = 0;
  let releaseSearches;
  const allStarted = new Promise(resolve => { releaseSearches = resolve; });
  const waitForAll = async () => {
    started += 1;
    if (started === 4) releaseSearches();
    await allStarted;
  };
  const fetchImpl = async url => {
    const request = new URL(url);
    await waitForAll();
    const titles = [1, 2, 3].map(index => `${concept} ${request.hostname} ${index}`);
    if (request.hostname === 'api.openverse.org') return { ok: true, async json() { return { results: titles.map((title, index) => ({ title, thumbnail: `https://openverse.example/${index}.jpg`, foreign_landing_url: `https://openverse.example/source/${index}`, tags: concept.split(' '), category: 'photograph' })) }; } };
    if (request.hostname === 'commons.wikimedia.org') return { ok: true, async json() { return { query: { pages: Object.fromEntries(titles.map((title, index) => [index, { title: `File:${title}.jpg`, imageinfo: [{ thumburl: `https://wikimedia.example/${index}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${index}.jpg`, mime: 'image/jpeg', extmetadata: { ImageDescription: { value: concept } } }] }])) } }; } };
    if (request.hostname === 'www.loc.gov') return { ok: true, async json() { return { results: titles.map((title, index) => ({ id: `https://www.loc.gov/item/${index}/`, title, image_url: [`https://loc.example/${index}.jpg`], subject: concept.split(' ') })) }; } };
    return { ok: true, async json() { return { collection: { items: titles.map((title, index) => ({ data: [{ nasa_id: `NASA-${index}`, title, keywords: concept.split(' ') }], links: [{ href: `https://nasa.example/${index}.jpg`, render: 'image' }] })) } }; } };
  };

  const results = await findRelevantImages({ word: 'conquest', definition: 'A victory gained through force.' }, {
    fetchImpl,
    aiScenes: false,
    extraQueries: [concept],
    onlyExtraQueries: true,
    limit: 10
  });

  assert.equal(started, 4);
  assert.equal(results.length, 10);
  assert.deepEqual(results.slice(0, 4).map(result => result.source), ['Openverse', 'Wikimedia Commons', 'Library of Congress', 'NASA Images']);
});

test('result-page changes are forwarded to every image provider', async () => {
  const requested = new Map();
  const fetchImpl = async url => {
    const request = new URL(url);
    requested.set(request.hostname, request);
    if (request.hostname === 'api.pexels.com') return { ok: true, async json() { return { photos: [] }; } };
    if (request.hostname === 'api.openverse.org') return { ok: true, async json() { return { results: [] }; } };
    if (request.hostname === 'commons.wikimedia.org') return { ok: true, async json() { return { query: { pages: {} } }; } };
    if (request.hostname === 'www.loc.gov') return { ok: true, async json() { return { results: [] }; } };
    return { ok: true, async json() { return { collection: { items: [] } }; } };
  };

  await findRelevantImages({ word: 'unique-pagination-word', definition: 'A test meaning.' }, {
    provider: 'pexels', pexelsApiKey: 'test-key', fetchImpl, aiScenes: false,
    extraQueries: ['unique pagination scene'], onlyExtraQueries: true, page: 2
  });

  assert.equal(requested.get('api.pexels.com').searchParams.get('page'), '2');
  assert.equal(requested.get('api.openverse.org').searchParams.get('page'), '2');
  assert.equal(requested.get('commons.wikimedia.org').searchParams.get('gsroffset'), '40');
  assert.equal(requested.get('www.loc.gov').searchParams.get('sp'), '2');
  assert.equal(requested.get('images-api.nasa.gov').searchParams.get('page'), '2');
});

test('image provider preference and key can be backed up and restored', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  saveImageProviderSettings({ provider: 'pexels', pexelsApiKey: ' local-key ', updatedAt: '2026-08-21T10:00:00.000Z' }, storage);
  assert.deepEqual(getImageProviderSettings(storage), { provider: 'pexels', pexelsApiKey: 'local-key', updatedAt: '2026-08-21T10:00:00.000Z' });
  const backup = getImageProviderBackupRecord(storage);
  const restoredValues = new Map();
  const restoredStorage = {
    getItem: key => restoredValues.get(key) || null,
    setItem: (key, value) => restoredValues.set(key, value)
  };
  restoreImageProviderBackupRecord(backup, restoredStorage);
  assert.deepEqual(getImageProviderSettings(restoredStorage), backup);
});

test('saved Pexels settings are read automatically and Pexels results are returned first', async () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  saveImageProviderSettings({ provider: 'pexels', pexelsApiKey: 'saved-device-key', updatedAt: '2026-08-21T10:00:00.000Z' }, storage, { silent: true });
  const requested = [];
  const fetchImpl = async (url, options = {}) => {
    const request = new URL(url);
    requested.push({ host: request.hostname, query: request.searchParams.get('query') || request.searchParams.get('q'), authorization: options.headers?.Authorization || '' });
    if (request.hostname === 'api.pexels.com') return { ok: true, async json() { return { photos: [{
      url: 'https://www.pexels.com/photo/42/', photographer: 'A Photographer', alt: 'Soldier holding a flag', width: 1200, height: 800,
      src: { large: 'https://images.pexels.com/photos/42/large.jpeg' }
    }] }; } };
    return { ok: true, async json() { return {}; } };
  };

  const results = await findRelevantImages({ word: 'conquest', definition: 'A victory gained through force.' }, {
    storage, fetchImpl, aiScenes: false, extraQueries: ['soldier planting a flag on a captured hilltop'], onlyExtraQueries: true, limit: 10
  });

  assert.equal(requested.find(item => item.host === 'api.pexels.com')?.authorization, 'saved-device-key');
  assert.equal(requested.find(item => item.host === 'api.pexels.com')?.query, 'soldier flag hilltop');
  assert.equal(results[0].source, 'Pexels');
});

test('visual scenes are sense-specific for identical spellings without a curated exception list', () => {
  const movement = buildVisualSceneDescriptions({ word: 'run', partOfSpeech: 'verb', definition: 'Move quickly on foot.' });
  const business = buildVisualSceneDescriptions({ word: 'run', partOfSpeech: 'verb', definition: 'Manage and operate a business.' });
  assert.notDeepEqual(movement, business);
  assert.match(movement[0], /athlete sprinting/);
  assert.match(business[0], /manager directing employees/);
});

test('the same definition produces the same automatic concepts regardless of spelling or part of speech', () => {
  const first = buildVisualSceneDescriptions({ word: 'malleable', partOfSpeech: 'adjective', definition: 'capable of being shaped by hand', example: 'Metal can be malleable.' });
  const second = buildVisualSceneDescriptions({ word: 'unrelated spelling', partOfSpeech: 'noun', definition: 'capable of being shaped by hand', example: 'A baker made bread.' });
  assert.deepEqual(first, second);
  assert.equal(first.some(query => /metal|baker|bread|malleable|unrelated/.test(query)), false);
});

test('wrong image feedback persists exclusions and more-like-this prioritizes the scene', async () => {
  const rejectedUrl = 'https://images.example/Wrong.jpg';
  let word = { word: 'meager', partOfSpeech: 'adjective', definition: 'lacking in quantity' };
  word.imageFeedback = updateImageFeedback(word, 'wrong', { url: rejectedUrl, searchQuery: 'tiny dinner portion' });
  word.imageFeedback = updateImageFeedback(word, 'more-like-this', { searchQuery: 'nearly empty dinner plate' });
  assert.deepEqual(imageFeedbackFor(word).rejectedUrls, [rejectedUrl]);
  assert.equal(imageFeedbackFor(word).preferredConcepts[0], 'nearly empty dinner plate');

  const results = await findRelevantImages(word, {
    extraQueries: ['nearly empty dinner plate'], onlyExtraQueries: true,
    fetchImpl: async () => ({ ok: true, async json() { return { results: [
      { title: 'Nearly empty dinner plate', thumbnail: rejectedUrl, foreign_landing_url: 'https://source.example/wrong', tags: [{ name: 'empty' }, { name: 'plate' }] },
      { title: 'Nearly empty dinner plate at home', thumbnail: 'https://images.example/good.jpg', foreign_landing_url: 'https://source.example/good', tags: [{ name: 'empty' }, { name: 'plate' }] }
    ] }; } })
  });
  assert.equal(results.some(image => image.url === rejectedUrl), false);
  assert.equal(results.some(image => image.url.includes('good.jpg')), true);
});
