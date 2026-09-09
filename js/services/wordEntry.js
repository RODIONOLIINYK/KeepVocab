import { fetchWordDetails } from './dictionaryApi.js?v=1602';
import { fetchLithuanianEntry } from './lithuanianEnrichment.js?v=1602';
import { bulkResultToWord, attachImagesSequentially } from './bulkWords.js?v=1602';
import { sanitizeExistingExamples } from './exampleSearch.js?v=1602';
import { findRelevantImages, imageUrlsForWords } from './imageSearch.js?v=1602';

export function fetchWordEntry(word, courseId = 'english', options = {}) {
  return courseId === 'lithuanian' ? fetchLithuanianEntry(word, options) : fetchWordDetails(word, options);
}

export function wordEntryToWord(entry, senseIndex = 0, courseId = 'english') {
  const sense = entry.senses?.[senseIndex];
  if (!sense) throw new Error(`No meaning found for “${entry.word}”.`);
  return { ...bulkResultToWord({ term: entry.word, status: 'ready', data: entry }, senseIndex),
    courseId, sourceUrl: sense.sourceUrl || entry.sourceUrl,
    attribution: sense.attribution || entry.attribution };
}

// Shared by the Add Word pop-up, the main Add Words widget, and lesson vocabulary.
export async function prepareWordsForLibrary(words, { courseId = 'english', existingWords = [], onProgress, findImages = findRelevantImages } = {}) {
  const checked = words.map(word => {
    const item = { ...word, courseId: word.courseId || courseId };
    if (!item.word || !String(item.definition || '').trim()) throw new Error('Choose a meaning before saving.');
    return item.courseId === 'lithuanian' ? item : sanitizeExistingExamples(item.word, [item])[0];
  });
  return attachImagesSequentially(checked, findImages, { excludeUrls: imageUrlsForWords(existingWords), onProgress });
}
