import { fetchEnglishEntry, enrichEnglishEntry } from './englishEnrichment.js?v=18200';
import { withEntryTranslations } from './dictionaryApi.js?v=18200';
import { bulkResultToWord, attachImagesSequentially } from './bulkWords.js?v=18200';
import { sanitizeExistingExamples } from './exampleSearch.js?v=18200';
import { findRelevantImages, imageUrlsForWords } from './imageSearch.js?v=18200';

export function fetchWordEntry(word, _courseId = 'english', options = {}) {
  return fetchEnglishEntry(word, options);
}

// Explicit requests bypass dictionary results and the AI cache for a fresh suggestion.
export function fetchAiWordEntry(word, _courseId = 'english', options = {}) {
  return enrichEnglishEntry(word, { ...options, force: true });
}

export function wordEntryToWord(entry, senseIndex = 0) {
  const sense = entry.senses?.[senseIndex];
  if (!sense) throw new Error(`No meaning found for “${entry.word}”.`);
  return { ...bulkResultToWord({ term: entry.word, status: 'ready', data: entry }, senseIndex),
    courseId: 'english', sourceUrl: sense.sourceUrl || entry.sourceUrl,
    attribution: sense.attribution || entry.attribution };
}

// Shared by the Add Word pop-up, the main Add Words widget, and quick add.
export async function prepareWordsForLibrary(words, { existingWords = [], onProgress, findImages = findRelevantImages, ...translationOptions } = {}) {
  const checked = words.map(word => {
    const item = { ...word, courseId: 'english' };
    if (!item.word || !String(item.definition || '').trim()) throw new Error('Choose a meaning before saving.');
    return sanitizeExistingExamples(item.word, [item])[0];
  });
  const translated = await withEntryTranslations({ senses: checked }, translationOptions);
  return attachImagesSequentially(translated.senses, findImages, { excludeUrls: imageUrlsForWords(existingWords), onProgress });
}
