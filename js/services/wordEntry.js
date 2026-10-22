import { fetchEnglishEntry, enrichEnglishEntry } from './englishEnrichment.js?v=18800';
import { withEntryTranslations } from './dictionaryApi.js?v=18800';
import { bulkResultToWord, attachImagesSequentially } from './bulkWords.js?v=18800';
import { sanitizeExistingExamples } from './exampleSearch.js?v=18800';
import { findRelevantImages, imageUrlsForWords, prepareImageScenes } from './imageSearch.js?v=18800';
import { exampleForLearning, withLearnerExplanations } from './learningDefinitions.js?v=18800';

export async function fetchWordEntry(word, _courseId = 'english', options = {}) {
  return withLearnerExplanations(await fetchEnglishEntry(word, options), options);
}

// Explicit requests bypass dictionary results and the AI cache for a fresh suggestion.
export async function fetchAiWordEntry(word, _courseId = 'english', options = {}) {
  return withLearnerExplanations(await enrichEnglishEntry(word, { ...options, force: true }), options);
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
  const explained = await withLearnerExplanations({ senses: checked }, translationOptions);
  if (translationOptions.requireExamples && explained.senses.some(word => !exampleForLearning(word))) {
    throw new Error('Each meaning needs a modern example sentence using the word. Add the missing examples before saving.');
  }
  const translated = await withEntryTranslations(explained, translationOptions);
  const visualWords = await prepareImageScenes(translated.senses, translationOptions);
  return attachImagesSequentially(visualWords, findImages, { ...translationOptions, excludeUrls: imageUrlsForWords(existingWords), onProgress });
}
