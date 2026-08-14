import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVisualSceneDescriptions, buildVisualSearchQueries, canonicalVisualTerm, findPexelsImages, findRelevantImages, getImageProviderSettings, imageFeedbackFor, rankOpenverseImages, saveImageProviderSettings, updateImageFeedback } from '../js/services/imageSearch.js';

const runningWord = {
  word: 'to run',
  partOfSpeech: 'verb',
  definition: 'move at a speed faster than a walk'
};

test('image searches derive visible concepts from the selected definition', () => {
  assert.equal(canonicalVisualTerm('to run'), 'run');
  const queries = buildVisualSearchQueries(runningWord);
  assert.ok(queries.some(query => query.includes('move speed faster than walk')));
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
  assert.ok(queries.some(query => /^person /.test(query)));
  assert.match(queries[0], /stupid|foolish/);
  assert.equal(queries.some(query => query === 'idiot'), false);
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
    word: 'something else',
    partOfSpeech: 'noun',
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

  assert.match(louder[0], /increase|larger/);
  assert.match(musical[0], /tempo|meter/);
  assert.match(biological[0], /organism|produces|breeding/);
  assert.notEqual(louder[0], musical[0]);
});

test('uncurated verb senses include definition words instead of searching spelling alone', () => {
  const movement = buildVisualSearchQueries({ word: 'run', partOfSpeech: 'verb', definition: 'Move quickly on foot.' });
  const business = buildVisualSearchQueries({ word: 'run', partOfSpeech: 'verb', definition: 'Manage and operate a business.' });

  assert.match(movement[0], /move quickly foot/);
  assert.match(business[0], /manage operate business/);
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
    requestedQueries.push(new URL(url).searchParams.get('query'));
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

  assert.deepEqual(requestedQueries, ['soap bubble popping in sunlight']);
  assert.equal(results[0].searchQuery, 'soap bubble popping in sunlight');
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

test('image provider preference and key are stored only in the supplied browser storage', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  saveImageProviderSettings({ provider: 'pexels', pexelsApiKey: ' local-key ' }, storage);
  assert.deepEqual(getImageProviderSettings(storage), { provider: 'pexels', pexelsApiKey: 'local-key' });
});

test('visual scenes are sense-specific for identical spellings without a curated exception list', () => {
  const movement = buildVisualSceneDescriptions({ word: 'run', partOfSpeech: 'verb', definition: 'Move quickly on foot.' });
  const business = buildVisualSceneDescriptions({ word: 'run', partOfSpeech: 'verb', definition: 'Manage and operate a business.' });
  assert.notDeepEqual(movement, business);
  assert.match(movement[0], /move quickly foot/);
  assert.match(business[0], /manage operate business/);
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
