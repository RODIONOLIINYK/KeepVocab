import { imageSelectionPatch } from './imageSearch.js?v=18900';
import { hasUkrainianTranslation, TRANSLATION_LANGUAGE } from './dictionaryApi.js?v=18900';

export const MAX_BULK_WORDS = 100;
// Lookups remain sequential, with a short pacing gap instead of adding almost
// two minutes of idle time to a 100-word import.
export const BULK_LOOKUP_DELAY_MS = 150;

export function parseBulkWordList(value, limit = MAX_BULK_WORDS) {
  const seen = new Set();
  return String(value || '')
    .split(/[\n,;]+/)
    .map(item => item.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .filter(item => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(0, limit));
}

const wait = delayMs => delayMs > 0 ? new Promise(resolve => setTimeout(resolve, delayMs)) : Promise.resolve();

function isTransientLookupError(error) {
  return ['NETWORK', 'TIMEOUT', 'HTTP', 'RATE_LIMIT'].includes(String(error?.code || ''));
}

export async function lookupBulkWords(terms, lookup, options = {}) {
  const queue = [...terms].slice(0, MAX_BULK_WORDS);
  const results = [];
  const delayMs = Math.max(0, Number(options.delayMs ?? 0));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 500));
  const retries = Math.max(0, Math.min(3, Number(options.retries ?? 0)));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  for (let index = 0; index < queue.length; index += 1) {
    const term = queue[index];
    let attempt = 0;
    let result;
    while (!result) {
      try {
        const data = await lookup(term);
        result = { term, status: 'ready', data };
      } catch (error) {
        if (attempt < retries && isTransientLookupError(error)) {
          attempt += 1;
          await wait(retryDelayMs * attempt);
          continue;
        }
        result = { term, status: 'manual', error: error instanceof Error ? error.message : String(error) };
      }
    }
    results.push(result);
    onProgress({ completed: index + 1, total: queue.length, term, status: result.status });
    if (index < queue.length - 1) await wait(delayMs);
  }
  return results;
}

export async function retryMissingBulkWords(results, lookup, options = {}) {
  const missing = (results || [])
    .map((result, index) => ({ result, index }))
    .filter(item => item.result?.status !== 'ready');
  if (!missing.length) return [...(results || [])];

  const retried = await lookupBulkWords(missing.map(item => item.result.term), lookup, options);
  const merged = [...results];
  missing.forEach((item, retryIndex) => {
    merged[item.index] = {
      ...retried[retryIndex],
      manualDefinition: retried[retryIndex].status === 'ready' ? '' : item.result.manualDefinition || '',
      manualTranslation: retried[retryIndex].status === 'ready' ? '' : item.result.manualTranslation || ''
    };
  });
  return merged;
}

export function dedupeBulkResults(results) {
  const seen = new Set();
  return (results || []).filter(result => {
    const key = String(result?.data?.word || result?.term || '').trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const withoutImageCandidates = words => words.map(({ imageCandidates, ...word }) => word);

// Skipping optional images completes immediately even if a provider ignores
// cancellation. The rejected/late provider promise stays observed by the race.
export async function withSkippableImages(words, prepareImages, signal) {
  if (!signal) return prepareImages();
  if (signal.aborted) return withoutImageCandidates(words);
  let skip;
  const skipped = new Promise(resolve => {
    skip = () => resolve(withoutImageCandidates(words));
    signal.addEventListener('abort', skip, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => signal.aborted ? withoutImageCandidates(words) : prepareImages()),
      skipped
    ]);
  } finally { signal.removeEventListener('abort', skip); }
}

export async function attachImagesSequentially(words, findImages, options = {}) {
  return withSkippableImages(words, async () => {
    const excluded = new Set((options.excludeUrls || []).filter(Boolean));
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const enriched = [];
    const signal = options.skipImagesSignal && options.signal
      ? AbortSignal.any([options.skipImagesSignal, options.signal]) : options.skipImagesSignal || options.signal;

    for (let index = 0; index < words.length; index += 1) {
      if (options.skipImagesSignal?.aborted) return withoutImageCandidates(words);
      const word = { ...words[index] };
      try {
        const found = await findImages(word, { aiScenes: false, ...options, signal, excludeUrls: [...excluded], limit: 6 });
        if (options.skipImagesSignal?.aborted) return withoutImageCandidates(words);
        const candidates = (Array.isArray(found) ? found : []).filter(image => image?.url && ![image.url, image.sourceUrl].some(url => url && excluded.has(url)));
        // Transient review data: the picker shows one fetched group immediately,
        // instead of making the learner wait for another search after every skip.
        word.imageCandidates = candidates;
        const [image] = candidates;
        if (image?.url) {
          Object.assign(word, imageSelectionPatch(image));
          excluded.add(image.url);
          if (image.sourceUrl) excluded.add(image.sourceUrl);
        }
      } catch {
        // Image search is optional: keep the fully defined word if a provider is unavailable.
        if (options.skipImagesSignal?.aborted) return withoutImageCandidates(words);
      }
      enriched.push(word);
      onProgress({ completed: index + 1, total: words.length, word: word.word, found: Boolean(word.imageUrl) });
    }
    return enriched;
  }, options.skipImagesSignal);
}

export function bulkResultToWord(result, senseIndex = 0, manualDefinition = '', manualTranslation = result?.manualTranslation || '') {
  if (result?.status === 'ready') {
    const data = result.data || {};
    const senses = Array.isArray(data.senses) && data.senses.length ? data.senses : [data];
    const sense = senses[Math.max(0, Math.min(Math.floor(Number(senseIndex)) || 0, senses.length - 1))] || {};
    return {
      word: data.word || result.term,
      lemma: sense.lemma || data.lemma || data.word || result.term,
      phonetic: sense.phonetic || data.phonetic || '',
      audioUrl: sense.audioUrl || data.audioUrl || '',
      partOfSpeech: sense.partOfSpeech || 'unknown',
      definition: sense.definition || '',
      otherDefinitions: senses.filter(item => item !== sense).map(item => item.sourceDefinition || item.definition).filter(Boolean).slice(0, 8),
      sourceDefinition: sense.sourceDefinition || sense.definition || '',
      sourceDefinitions: sense.sourceDefinitions || [],
      sourceFingerprint: sense.sourceFingerprint || '',
      explanationSource: sense.explanationSource || '',
      explanationModel: sense.explanationModel || '',
      explanationVersion: sense.explanationVersion || 0,
      usageNote: sense.usageNote || '',
      needsExample: Boolean(sense.needsExample),
      translation: hasUkrainianTranslation(sense.translation) ? sense.translation.trim() : sense.definition || '',
      translationLanguage: hasUkrainianTranslation(sense.translation) ? TRANSLATION_LANGUAGE : 'en',
      acceptedForms: sense.acceptedForms || data.acceptedForms || [data.word || result.term],
      grammaticalTags: sense.grammaticalTags || data.grammaticalTags || [],
      labels: sense.labels || [],
      example: sense.example || '',
      exampleSourceUrl: sense.exampleSourceUrl || '',
      exampleAttribution: sense.exampleAttribution || '',
      exampleLicense: sense.exampleLicense || ''
    };
  }
  return {
    word: result?.term || '',
    lemma: result?.term || '',
    phonetic: '',
    audioUrl: '',
    partOfSpeech: 'unknown',
    definition: String(manualDefinition || '').trim(),
    translation: hasUkrainianTranslation(manualTranslation) ? manualTranslation.trim() : String(manualDefinition || '').trim(),
    translationLanguage: hasUkrainianTranslation(manualTranslation) ? TRANSLATION_LANGUAGE : 'en',
    acceptedForms: result?.term ? [result.term] : [],
    grammaticalTags: [],
    example: String(result?.manualExample || '').trim(),
    explanationSource: 'manual'
  };
}
