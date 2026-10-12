import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillLibraryTranslations } from '../js/services/libraryTranslations.js';
import { DriveSyncService, MemoryStorage } from '../js/services/driveSync.js';

function fixture(count = 1, language = 'uk') {
  const persistence = new DriveSyncService(new MemoryStorage());
  persistence.updateSettings({ translationLanguage: language }, { silent: true });
  const words = persistence.addWords(Array.from({ length: count }, (_, index) => ({
    word: `word${index}`, definition: `English meaning ${index}.`, translation: `English meaning ${index}.`, translationLanguage: 'en',
    example: `I use word${index} every day.`, acceptedForms: [`word${index}`, `word${index}s`],
    reviewCount: 8, difficulty: 2.1, mastered: false
  })));
  return { persistence, words };
}

test('default English backfill makes zero translation requests', async () => {
  const { persistence, words } = fixture(2, 'en');
  assert.equal(await backfillLibraryTranslations(words, {
    persistence, translate: async () => assert.fail('English mode must not translate')
  }), 0);
});

test('Ukrainian backfill patches only a saved translation and preserves IDs, examples, forms, and progress', async () => {
  const { persistence, words } = fixture();
  const original = words[0];
  assert.equal(await backfillLibraryTranslations(words, {
    persistence, translationLanguage: 'uk', translate: async () => 'Українське значення.'
  }), 1);
  const updated = persistence.getAllWords()[0];
  assert.equal(updated.translation, 'Українське значення.');
  assert.equal(updated.translationLanguage, 'uk');
  for (const field of ['id', 'senseId', 'definition', 'example', 'acceptedForms', 'reviewCount', 'difficulty', 'mastered']) assert.deepEqual(updated[field], original[field]);
  assert.equal(await backfillLibraryTranslations([updated], {
    persistence, translate: async () => assert.fail('Existing Ukrainian hints should be retained')
  }), 0);
});

test('backfill ignores translations edited manually and entries deleted while a request is in flight', async () => {
  for (const change of ['manual', 'definition', 'delete']) {
    const { persistence, words } = fixture();
    let resolveTranslation;
    const pending = backfillLibraryTranslations(words, {
      persistence, translate: () => new Promise(resolve => { resolveTranslation = resolve; })
    });
    await Promise.resolve();
    if (change === 'manual') persistence.updateWord(words[0].id, { translation: 'Мій власний переклад.', translationLanguage: 'uk' });
    else if (change === 'definition') persistence.updateWord(words[0].id, { definition: 'A newly chosen meaning.' });
    else persistence.deleteWord(words[0].id);
    resolveTranslation('Автоматичний переклад.');
    assert.equal(await pending, 0);
    if (change === 'manual') assert.equal(persistence.getAllWords()[0].translation, 'Мій власний переклад.');
    if (change === 'definition') assert.equal(persistence.getAllWords()[0].definition, 'A newly chosen meaning.');
    if (change === 'delete') assert.equal(persistence.getAllWords().length, 0);
  }
});

test('mode changes, cancellation, and stale view guards prevent pending translations from being saved', async () => {
  for (const change of ['english', 'cancel', 'stale']) {
    const { persistence, words } = fixture();
    const controller = new AbortController();
    let current = true;
    let resolveTranslation;
    const pending = backfillLibraryTranslations(words, {
      persistence, signal: controller.signal, isCurrent: () => current,
      translate: () => new Promise(resolve => { resolveTranslation = resolve; })
    });
    await Promise.resolve();
    if (change === 'english') persistence.updateSettings({ translationLanguage: 'en' });
    if (change === 'cancel') controller.abort();
    if (change === 'stale') current = false;
    resolveTranslation('Українське значення.');
    assert.equal(await pending, 0);
    assert.equal(persistence.getAllWords()[0].translationLanguage, 'en');
  }
});

test('backfill bounds concurrency and the number of entries, shares active runs, and stops after network failure', async () => {
  const { persistence, words } = fixture(30);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const options = { persistence, maxWords: 5, concurrency: 2, translate: async () => {
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    return 'Українське значення.';
  } };
  const first = backfillLibraryTranslations(words, options);
  const second = backfillLibraryTranslations(words, options);
  assert.deepEqual(await Promise.all([first, second]), [5, 5]);
  assert.equal(calls, 5);
  assert.equal(peak, 2);
  let failedCalls = 0;
  assert.equal(await backfillLibraryTranslations(persistence.getAllWords(), {
    persistence, concurrency: 2, translate: async () => { failedCalls += 1; throw new TypeError('offline'); }
  }), 0);
  assert.ok(failedCalls <= 2);
});
