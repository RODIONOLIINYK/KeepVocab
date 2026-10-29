import { fetchEnglishEntry, enrichEnglishEntry } from './englishEnrichment.js?v=18900';
import { withEntryTranslations } from './dictionaryApi.js?v=18900';
import { bulkResultToWord, attachImagesSequentially, withSkippableImages } from './bulkWords.js?v=18900';
import { sanitizeExistingExamples } from './exampleSearch.js?v=18900';
import { findRelevantImages, imageUrlsForWords, prepareImageScenes } from './imageSearch.js?v=18900';
import { withLearnerExplanations } from './learningDefinitions.js?v=18900';

export async function fetchWordEntry(word, _courseId = 'english', options = {}) {
  const entry = await fetchEnglishEntry(word, options);
  return withLearnerExplanations(entry, entry.aiGenerated ? { ...options, learnerExplanations: false } : options);
}

// Explicit requests bypass dictionary results and the AI cache for a fresh suggestion.
export async function fetchAiWordEntry(word, _courseId = 'english', options = {}) {
  // This request already asks for learner wording and an example. A second AI
  // pass would charge again for the same suggestion before it is even shown.
  return withLearnerExplanations(await enrichEnglishEntry(word, { ...options, force: true }), { ...options, learnerExplanations: false });
}

// Bulk lookup defers clarity rewrites until all dictionary entries are ready,
// so difficult senses share a request instead of making one per word.
export async function prepareBulkLearnerExplanations(results, options = {}) {
  const selected = results.flatMap((result, index) => {
    if (result.status !== 'ready') return [];
    const senses = result.data.senses?.length ? result.data.senses : [result.data];
    const senseIndex = Math.max(0, Math.min(Math.floor(Number(result.selectedSenseIndex)) || 0, senses.length - 1));
    return [{ index, senseIndex, sense: { ...senses[senseIndex], word: result.data.word || result.term } }];
  });
  if (!selected.length) return results;
  // Bulk rows import one chosen meaning; rewriting every unselected dictionary
  // sense can multiply the request cost before the learner has chosen it.
  const explained = await withLearnerExplanations({ senses: selected.map(item => item.sense) }, options);
  const replacements = new Map(selected.map((item, index) => [item.index, { ...item, sense: explained.senses[index] }]));
  return results.map((result, index) => {
    const replacement = replacements.get(index);
    if (!replacement) return result;
    const updated = [...(result.data.senses?.length ? result.data.senses : [result.data])];
    updated[replacement.senseIndex] = replacement.sense;
    return { ...result, data: { ...result.data, senses: updated, ...updated[0] } };
  });
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
  // Saving never makes another paid explanation request or requires an example.
  // Keep trustworthy dictionary examples; missing/unsuitable ones can be added later.
  const explained = await withLearnerExplanations({ senses: checked }, { ...translationOptions, learnerExplanations: false });
  const imageOptions = { ...translationOptions };
  const withOtherDefinitions = word => ({ ...word, otherDefinitions: [...new Set([
    ...(word.otherDefinitions || []),
    ...existingWords.filter(item => String(item.word || '').toLowerCase() === word.word.toLowerCase()).map(item => item.sourceDefinition || item.definition)
  ].filter(definition => definition && definition !== (word.sourceDefinition || word.definition)))] });
  const scenesPromise = imageOptions.skipImagesSignal?.aborted
    ? Promise.resolve(null)
    : prepareImageScenes(explained.senses.map(withOtherDefinitions), imageOptions).catch(() => null);
  const translated = await withEntryTranslations(explained, translationOptions);
  return withSkippableImages(translated.senses, async () => {
    const preparedScenes = await scenesPromise;
    const visualWords = translated.senses.map((word, index) => {
      const item = withOtherDefinitions(word);
      if (preparedScenes?.[index]?.imageScenes) item.imageScenes = preparedScenes[index].imageScenes;
      else delete item.imageScenes;
      return item;
    });
    if (imageOptions.skipImagesSignal?.aborted) return translated.senses;
    // Scenes are prepared together above. Image providers reuse those exact
    // meaning prompts without starting another paid generation for each word.
    return attachImagesSequentially(visualWords, findImages, { ...imageOptions, aiScenes: false, excludeUrls: imageUrlsForWords(existingWords), onProgress });
  }, imageOptions.skipImagesSignal);
}
