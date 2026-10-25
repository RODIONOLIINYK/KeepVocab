import test from 'node:test';
import assert from 'node:assert/strict';

import { activeImageResultCandidates, activeImageSearchQueries, groupWordCards, imageUrlsUsedByOtherWords, nextImageSuggestionState, remainingImageCandidates, renderLibraryView, reusedImageUrls, reviewedImagePatch } from '../js/components/LibraryView.js';
import { driveSync } from '../js/services/driveSync.js?v=18900';

// Exercise the real editor callbacks with only the DOM operations they use.
// Rendering replaces controls, as a browser's innerHTML assignment does.
class LibraryContainer {
  controls = new Map();
  markup = '';
  set innerHTML(value) { this.markup = value; this.controls.clear(); }
  get innerHTML() { return this.markup; }
  control(key, dataset = {}) {
    if (!this.controls.has(key)) this.controls.set(key, {
      dataset, value: '', textContent: '', listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      scrollIntoView() {},
      querySelector(selector) { return selector === 'img' ? {
        complete: true, naturalWidth: 300,
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 })
      } : null; }
    });
    return this.controls.get(key);
  }
  querySelector(selector) {
    if (!selector.startsWith('#') || !this.markup.includes(`id="${selector.slice(1)}"`)) return null;
    return this.control(selector);
  }
  querySelectorAll(selector) {
    if (!['[data-edit-word]', '[data-library-image]'].includes(selector)) return [];
    const attribute = selector.slice(1, -1);
    const property = attribute.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return [...this.markup.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))]
      .map(match => this.control(`${attribute}:${match[1]}`, { [property]: match[1] }));
  }
  click(selector, index = 0) {
    const button = selector.startsWith('#') ? this.querySelector(selector) : this.querySelectorAll(selector)[index];
    assert.ok(button?.listeners.click, `${selector} has a click handler`);
    return button.listeners.click({ currentTarget: button });
  }
}

function replaceGlobal(context, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  context.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}

function installImageEditor(context, prompt, count = 2, beforePhotoResponse = null) {
  const values = new Map();
  replaceGlobal(context, 'localStorage', { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) });
  replaceGlobal(context, 'window', { innerWidth: 1000, innerHeight: 1000 });
  const word = { id: 'running', word: 'run', partOfSpeech: 'verb', definition: 'Move quickly on foot.', monthYear: 'October 2026', imageCustomConcept: prompt };
  const methods = ['getActiveNotebook', 'getWords', 'getWordsByMonthYear', 'getMonthlyArchives', 'updateWord'];
  const original = new Map(methods.map(name => [name, driveSync[name]]));
  context.after(() => { for (const [name, method] of original) driveSync[name] = method; });
  const patches = [];
  driveSync.getActiveNotebook = () => 'October 2026 Vocabulary';
  driveSync.getWords = driveSync.getWordsByMonthYear = () => [word];
  driveSync.getMonthlyArchives = () => [];
  driveSync.updateWord = (id, patch) => { assert.equal(id, word.id); patches.push(patch); Object.assign(word, patch); };
  const requests = [];
  replaceGlobal(context, 'fetch', async value => {
    const url = new URL(value);
    requests.push({ host: url.hostname, prompt: url.searchParams.get('q'), page: url.searchParams.get('page') });
    if (url.hostname === 'api.openverse.org') await beforePhotoResponse?.();
    return { ok: true, json: async () => url.hostname === 'api.openverse.org' ? { results: Array.from({ length: count }, (_item, index) => ({
      title: index ? 'Running fox leaping through meadow' : 'Fox standing beside running stream in meadow',
      thumbnail: `https://library-feedback.test/${encodeURIComponent(prompt)}/${index}.jpg`,
      foreign_landing_url: `https://library-feedback.test/${encodeURIComponent(prompt)}/source/${index}`,
      tags: [{ name: 'running' }, { name: 'fox' }], category: 'photograph'
    })) } : {} };
  });
  const container = new LibraryContainer();
  renderLibraryView(container);
  return { word, container, requests, patches };
}

async function finishImageSearch(container) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!container.innerHTML.includes('image-suggestion-loading')) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('image search did not finish');
}

test('library identifies an image reused by multiple meaning cards', () => {
  const duplicates = reusedImageUrls([
    { id: '1', imageUrl: 'https://images.example/shared.jpg' },
    { id: '2', imageUrl: 'https://images.example/shared.jpg' },
    { id: '3', imageUrl: 'https://images.example/unique.jpg' },
    { id: '4', imageUrl: '' }
  ]);

  assert.deepEqual([...duplicates], ['https://images.example/shared.jpg']);
});

test('library groups different meanings of the same spelling into one card', () => {
  const groups = groupWordCards([
    { id: 'bank-finance', word: 'Bank', definition: 'A financial institution.' },
    { id: 'bank-river', word: 'bank', definition: 'Land beside a river.' },
    { id: 'steady', word: 'steady', definition: 'Firmly fixed.' }
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].meanings.map(meaning => meaning.id), ['bank-finance', 'bank-river']);
});

test('identical suggested and custom concept text produces one identical search query', () => {
  const suggestion = 'worker pulling two joined metal pieces apart';
  const custom = 'worker pulling two joined metal pieces apart';
  assert.deepEqual(activeImageSearchQueries(suggestion), [suggestion]);
  assert.deepEqual(activeImageSearchQueries(custom), activeImageSearchQueries(suggestion));
});

test('More images cycles every visible concept and then advances the result page', () => {
  const scenes = ['first visible scene', 'second visible scene', 'third visible scene'];
  const second = nextImageSuggestionState(scenes, scenes[0], 1);
  const third = nextImageSuggestionState(scenes, second.concept, second.page);
  const nextPage = nextImageSuggestionState(scenes, third.concept, third.page);
  assert.deepEqual(second, { concept: scenes[1], page: 1, index: 1 });
  assert.deepEqual(third, { concept: scenes[2], page: 1, index: 2 });
  assert.deepEqual(nextPage, { concept: scenes[0], page: 2, index: 0 });
  assert.deepEqual(nextImageSuggestionState([], 'custom scene', 2), { concept: 'custom scene', page: 3, index: -1 });
});

test('a word keeps its own saved image eligible while images used by other words stay excluded', () => {
  const excluded = imageUrlsUsedByOtherWords([
    { id: 'current', imageUrl: 'https://images.example/current.jpg', imageSourceUrl: 'https://source.example/current' },
    { id: 'other', imageUrl: 'https://images.example/other.jpg', imageSourceUrl: 'https://source.example/other' }
  ], 'current');
  assert.deepEqual(excluded, ['https://images.example/other.jpg', 'https://source.example/other']);
});

test('the current saved image stays outside fresh query results', () => {
  const current = { url: 'https://images.example/current.jpg', sourceUrl: 'https://source.example/current', isCurrent: true };
  const results = activeImageResultCandidates(current, [
    { url: current.url, sourceUrl: current.sourceUrl },
    { url: 'https://images.example/new.jpg', sourceUrl: 'https://source.example/new' }
  ]);
  assert.deepEqual(results, [{ url: 'https://images.example/new.jpg', sourceUrl: 'https://source.example/new' }]);
});

test('rejecting one photo removes its source aliases and preserves same-prompt photos', () => {
  const rejected = { url: 'https://photos.test/standing-small.jpg', sourceUrl: 'https://photos.test/standing', searchQuery: 'running fox' };
  const alias = { ...rejected, url: 'https://photos.test/standing-large.jpg' };
  const running = { url: 'https://photos.test/running.jpg', sourceUrl: 'https://photos.test/running', searchQuery: rejected.searchQuery };
  assert.deepEqual(remainingImageCandidates([rejected, alias, running], rejected), [running]);
});

test('saving review replays only this meaning’s explicit feedback onto the latest synced preferences', () => {
  const latest = { id: 'fox', word: 'run', definition: 'Move quickly on foot.', imageFeedback: { rejectedUrls: ['https://photos.test/synced-wrong.jpg'], preferredConcepts: ['running fox'], goodUrls: [] } };
  const reviewed = { ...latest, imageUrl: 'https://photos.test/chosen.jpg', imageFeedback: { rejectedUrls: [] } };
  const wrong = { url: 'https://photos.test/standing.jpg' };
  const patch = reviewedImagePatch(latest, reviewed, [
    { word: latest, action: 'wrong', image: wrong },
    { word: latest, action: 'less-preferred', image: { url: 'https://photos.test/also-valid.jpg' } },
    { word: { id: 'other' }, action: 'wrong', image: { url: 'https://photos.test/other-meaning.jpg' } }
  ]);
  assert.deepEqual(patch.imageFeedback.rejectedUrls, [wrong.url, 'https://photos.test/synced-wrong.jpg']);
  assert.deepEqual(patch.imageFeedback.preferredConcepts, ['running fox']);
  assert.equal(patch.imageUrl, reviewed.imageUrl);
  assert.equal(Object.hasOwn(reviewedImagePatch(latest, reviewed), 'imageFeedback'), false, 'untouched feedback must stay current');
});

test('the actual Wrong meaning handler keeps running-fox peers and the current prompt/page', async context => {
  const { container, word, requests } = installImageEditor(context, 'running fox rejection gallery');
  container.click('[data-edit-word]');
  await finishImageSearch(container);
  container.click('#refresh-library-images');
  await finishImageSearch(container);
  assert.match(container.innerHTML, /Searching: “running fox rejection gallery” · page 2/);
  container.click('[data-library-image]');
  const selectedUrl = container.innerHTML.match(/class="selected-image-preview"><img src="([^"]+)"/)[1];
  const before = requests.length;
  container.click('#image-wrong');
  assert.equal(requests.length, before, 'a peer remains, so rejection needs no replacement search');
  assert.match(container.innerHTML, /Searching: “running fox rejection gallery” · page 2/);
  assert.equal(container.querySelectorAll('[data-library-image]').length, 1);
  assert.doesNotMatch(container.innerHTML, new RegExp(selectedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(word.imageFeedback.rejectedUrls, [selectedUrl, selectedUrl.replace('/0.jpg', '/source/0')]);
  assert.deepEqual(word.imageFeedback.preferredConcepts, []);
});

test('rejecting the last photo refills the same concept/page rather than advancing to another scene', async context => {
  const { container } = installImageEditor(context, 'running fox rejection refill', 1);
  container.click('[data-edit-word]');
  await finishImageSearch(container);
  container.click('#refresh-library-images');
  await finishImageSearch(container);
  container.click('[data-library-image]');
  container.click('#image-wrong');
  await finishImageSearch(container);
  assert.match(container.innerHTML, /Searching: “running fox rejection refill” · page 2/);
  assert.equal(container.querySelectorAll('[data-library-image]').length, 0);
  assert.match(container.innerHTML, /No images matched this custom interpretation/);
});

test('rejecting the saved photo clears that photo while preserving the current search gallery', async context => {
  const prompt = 'running fox rejection saved photo';
  const { container, word, requests } = installImageEditor(context, prompt);
  word.imageUrl = `https://library-feedback.test/${encodeURIComponent(prompt)}/0.jpg`;
  word.imageSourceUrl = `https://library-feedback.test/${encodeURIComponent(prompt)}/source/0`;
  const savedUrl = word.imageUrl;
  container.click('[data-edit-word]');
  await finishImageSearch(container);
  assert.equal(container.querySelectorAll('[data-library-image]').length, 1);
  const before = requests.length;
  container.click('#image-wrong');
  assert.equal(requests.length, before);
  assert.equal(word.imageUrl, '');
  assert.ok(word.imageFeedback.rejectedUrls.includes(savedUrl));
  assert.match(container.innerHTML, /Searching: “running fox rejection saved photo” · page 1/);
  assert.match(container.innerHTML, /Running fox leaping through meadow/);
  assert.equal(container.querySelectorAll('[data-library-image]').length, 1);
});

test('image feedback is blocked when the saved meaning changes while its editor is open', async context => {
  const { container, word, patches } = installImageEditor(context, 'running fox changed sense');
  container.click('[data-edit-word]');
  await finishImageSearch(container);
  container.click('[data-library-image]');
  word.definition = 'Manage and operate a business.';
  const before = patches.length;
  container.click('#image-wrong');
  assert.equal(patches.length, before);
  assert.equal(word.imageFeedback, undefined);
  assert.match(container.querySelector('#library-edit-message').textContent, /Save the intended meaning before hiding/);
});

test('pending image results cannot be attached to a different meaning received during sync', async context => {
  let finishResponse;
  const response = new Promise(resolve => { finishResponse = resolve; });
  const { container, word, requests } = installImageEditor(context, 'running fox pending sync meaning', 2, () => response);
  container.click('[data-edit-word]');
  for (let attempt = 0; attempt < 20 && !requests.some(request => request.host === 'api.openverse.org'); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(requests.some(request => request.host === 'api.openverse.org'), 'the original meaning search is in flight');
  assert.match(container.innerHTML, /image-suggestion-loading/);
  word.definition = 'Manage and operate a business.';
  finishResponse();
  await finishImageSearch(container);
  assert.equal(container.querySelectorAll('[data-library-image]').length, 0);
  assert.doesNotMatch(container.innerHTML, /Running fox leaping through meadow|Fox standing beside running stream/);
  assert.match(container.innerHTML, /meaning changed/i);
  assert.equal(word.imageFeedback, undefined);
});

test('a synced meaning change during scene preparation cancels the obsolete photo search', async context => {
  const { container, word, requests } = installImageEditor(context, 'running fox pending scene meaning');
  container.click('[data-edit-word]');
  word.definition = 'Manage and operate a business.';
  await finishImageSearch(container);
  assert.deepEqual(requests, []);
  assert.equal(container.querySelectorAll('[data-library-image]').length, 0);
  assert.match(container.innerHTML, /meaning changed/i);
});
