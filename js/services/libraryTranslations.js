import { driveSync } from './driveSync.js?v=18600';
import { hasUkrainianTranslation, translateEnglishText } from './dictionaryApi.js?v=18600';
import { getTranslationLanguage, normalizeTranslationLanguage } from './translationSettings.js?v=18600';

const activeBackfills = new WeakMap();

// Add hints to existing vocabulary without replacing a saved sense or its review state.
export async function backfillLibraryTranslations(words, { persistence = driveSync, ...options } = {}) {
  const storage = options.storage === undefined ? persistence.storage : options.storage;
  const currentLanguage = () => typeof persistence.getSettings === 'function'
    ? normalizeTranslationLanguage(persistence.getSettings()?.translationLanguage)
    : getTranslationLanguage(storage);
  if (normalizeTranslationLanguage(options.translationLanguage ?? currentLanguage()) !== 'uk' || currentLanguage() !== 'uk') return 0;
  if (activeBackfills.has(persistence)) return activeBackfills.get(persistence);

  const isCurrent = () => !options.signal?.aborted && currentLanguage() === 'uk' && (!options.isCurrent || options.isCurrent());
  const translate = options.translate || translateEnglishText;
  const maxWords = Math.max(0, Math.min(100, Math.floor(Number(options.maxWords ?? 20)) || 0));
  const concurrency = Math.max(1, Math.min(3, Math.floor(Number(options.concurrency ?? 2)) || 1));
  const seen = new Set();
  const queue = (Array.isArray(words) ? words : []).filter(word => {
    if (!word?.id || seen.has(word.id) || !String(word.definition || '').trim() || hasUkrainianTranslation(word.translation)) return false;
    seen.add(word.id);
    return (word.courseId || 'english') === 'english';
  }).slice(0, maxWords).map(({ id, word, definition, translation, translationLanguage }) => ({ id, word, definition, translation, translationLanguage }));
  const readCurrent = id => (persistence.getAllWords?.() || persistence.getWords?.() || []).find(word => word.id === id);
  const unchanged = (current, original) => current && ['word', 'definition', 'translation', 'translationLanguage'].every(key => current[key] === original[key]);

  let nextIndex = 0;
  let updatedCount = 0;
  let unavailable = false;
  const pendingTranslations = new Map();
  const run = async () => {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (!unavailable && isCurrent() && nextIndex < queue.length) {
        const original = queue[nextIndex++];
        if (!unchanged(readCurrent(original.id), original)) continue;
        let translation;
        try {
          if (!pendingTranslations.has(original.definition)) pendingTranslations.set(original.definition, Promise.resolve().then(() => translate(original.definition, { ...options, storage })));
          translation = await pendingTranslations.get(original.definition);
        } catch {
          unavailable = true;
          continue;
        }
        if (!isCurrent() || !hasUkrainianTranslation(translation) || !unchanged(readCurrent(original.id), original)) continue;
        try {
          persistence.updateWord(original.id, { translation: translation.trim(), translationLanguage: 'uk' });
          updatedCount += 1;
        } catch { /* A concurrently removed entry stays removed. */ }
      }
    }));
    return updatedCount;
  };
  const pending = run().finally(() => {
    if (activeBackfills.get(persistence) === pending) activeBackfills.delete(persistence);
  });
  activeBackfills.set(persistence, pending);
  return pending;
}
