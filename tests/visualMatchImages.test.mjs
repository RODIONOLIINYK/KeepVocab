import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVisualMatchMode } from '../js/components/VisualMatchMode.js';
import { driveSync } from '../js/services/driveSync.js?v=18908';

test('Visual Match starts with saved data images without searching for replacements', async context => {
  let words = ['jump', 'run'].map((word, index) => ({
    id: `inline-${index}`, word, definition: index ? 'Move quickly on foot.' : 'Push off the ground into the air.', monthYear: 'November 2026',
    imageUrl: `data:image/webp;base64,${index ? 'AQID' : 'AAAA'}`,
    imageSourceUrl: '', imageAttribution: 'Uploaded image',
    createdAt: '2026-11-01T00:00:00.000Z', nextReviewDate: '2026-11-01T00:00:00.000Z'
  }));
  let settings = {};
  const overrides = {
    getActiveNotebook: () => 'November 2026 Vocabulary',
    getWordsByMonthYear: () => words,
    getWords: () => words,
    getSettings: () => settings,
    updateSettings: patch => { settings = { ...settings, ...patch }; },
    saveWords: value => { words = value; }
  };
  for (const [name, value] of Object.entries(overrides)) {
    const original = driveSync[name];
    context.after(() => { driveSync[name] = original; });
    driveSync[name] = value;
  }
  for (const [name, value] of Object.entries({ window: { location: { hash: '#visual' } } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    context.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  let searches = 0;
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => { searches += 1; throw new Error('Image search must not run for saved cues.'); };
  context.after(() => { globalThis.fetch = fetch; });
  const container = {
    innerHTML: '',
    querySelector: () => ({ addEventListener() {} }),
    querySelectorAll: () => []
  };
  await renderVisualMatchMode(container);
  assert.match(container.innerHTML, /Which word best matches this image/);
  assert.match(container.innerHTML, /src="data:image\/webp;base64,/);
  assert.doesNotMatch(container.innerHTML, /Preparing visual cues|href="data:/);
  assert.equal(searches, 0);
});
