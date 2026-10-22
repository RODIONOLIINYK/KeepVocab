// Fast dictionary lookup with a maintained Wiktionary source, a short fallback, and offline cache.

import { isModernUsageExample, sanitizeExistingExamples } from './exampleSearch.js?v=18900';
import { groupSimilarSenses } from './learningDefinitions.js?v=18900';
import { cacheEntryIsFresh, readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=18900';
import { getTranslationLanguage, normalizeTranslationLanguage } from './translationSettings.js?v=18900';

const PRIMARY_API_BASE = 'https://freedictionaryapi.com/api/v1/entries/en/';
const FALLBACK_API_BASE = 'https://api.datamuse.com/words';
const CACHE_KEY = 'keepvocab_dictionary_cache_v4';
const CACHE_MAX_ENTRIES = 250;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3200;
const PRIMARY_TIMEOUT_MS = 2200;
const FALLBACK_TIMEOUT_MS = 1600;
const TRANSLATION_API_BASE = 'https://api.mymemory.translated.net/get';
const TRANSLATION_CACHE_KEY = 'keepvocab_ukrainian_translation_cache_v1';
const TRANSLATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const TRANSLATION_LANGUAGE = 'uk';

// Do not relabel an echoed English definition as a Ukrainian translation.
export function hasUkrainianTranslation(value) {
  return typeof value === 'string' && /[\u0400-\u04ff]/u.test(value);
}

export async function translateEnglishText(text, options = {}) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const cache = readObjectCache(storage, TRANSLATION_CACHE_KEY);
  const cached = cache[source];
  if (!options.force && cacheEntryIsFresh(cached, TRANSLATION_TTL_MS) && hasUkrainianTranslation(cached.data)) return cached.data;
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  try {
    if (!fetchImpl) throw new Error('Translation is unavailable.');
    // MyMemory accepts at most 500 UTF-8 bytes per segment. Keep long definitions intact.
    const chunks = [];
    let chunk = '';
    for (const token of source.match(/\S+\s*/g) || []) {
      if (new TextEncoder().encode(token.trim()).length > 500) throw new Error('Translation segment is too long.');
      if (chunk && new TextEncoder().encode(chunk + token).length > 500) {
        chunks.push(chunk.trim());
        chunk = '';
      }
      chunk += token;
    }
    if (chunk) chunks.push(chunk.trim());
    const translations = [];
    for (const segment of chunks) {
      const url = new URL(TRANSLATION_API_BASE);
      url.searchParams.set('q', segment);
      url.searchParams.set('langpair', 'en|uk');
      const payload = await requestJson(url.toString(), fetchImpl, options.translationTimeoutMs || options.timeoutMs || DEFAULT_TIMEOUT_MS, options.signal);
      const translation = String(payload?.responseData?.translatedText || '').trim();
      if (Number(payload?.responseStatus) !== 200 || !hasUkrainianTranslation(translation)) throw new Error('No Ukrainian translation was returned.');
      translations.push(translation);
    }
    const translated = translations.join(' ');
    // Other senses may have finished while this request was in flight.
    const updatedCache = readObjectCache(storage, TRANSLATION_CACHE_KEY);
    updatedCache[source] = { cachedAt: Date.now(), data: translated };
    writeRecentObjectCache(storage, TRANSLATION_CACHE_KEY, updatedCache, 500);
    return translated;
  } catch (error) {
    if (hasUkrainianTranslation(cached?.data)) return cached.data;
    throw error;
  }
}

export async function withUkrainianTranslations(entry, options = {}) {
  const translate = options.translate || translateEnglishText;
  const senses = (Array.isArray(entry.senses) ? entry.senses : [entry]).map(sense => ({
    ...sense,
    translation: hasUkrainianTranslation(sense.translation) ? sense.translation.trim() : '',
    translationLanguage: hasUkrainianTranslation(sense.translation) ? TRANSLATION_LANGUAGE : 'en'
  }));
  let nextIndex = 0;
  let unavailable = false;
  const pending = new Map();
  // Bound concurrent requests and stop starting more when the provider is unavailable.
  await Promise.all(Array.from({ length: Math.min(3, senses.length) }, async () => {
    while (!unavailable && nextIndex < senses.length) {
      const sense = senses[nextIndex++];
      if (sense.translation) continue;
      try {
        if (!pending.has(sense.definition)) pending.set(sense.definition, Promise.resolve().then(() => translate(sense.definition, options)));
        const translated = await pending.get(sense.definition);
        if (hasUkrainianTranslation(translated)) {
          sense.translation = translated.trim();
          sense.translationLanguage = TRANSLATION_LANGUAGE;
        }
      }
      catch { unavailable = true; }
    }
  }));
  return { ...entry, senses, ...senses[0] };
}

export function entryTranslationLanguage(options = {}) {
  return normalizeTranslationLanguage(options.translationLanguage ?? getTranslationLanguage(options.storage));
}

export async function withEntryTranslations(entry, options = {}) {
  if (entryTranslationLanguage(options) === TRANSLATION_LANGUAGE) return withUkrainianTranslations(entry, options);
  const senses = (Array.isArray(entry.senses) ? entry.senses : [entry]).map(sense => ({
    ...sense,
    translation: hasUkrainianTranslation(sense.translation) ? sense.translation.trim() : sense.definition || '',
    translationLanguage: hasUkrainianTranslation(sense.translation) ? TRANSLATION_LANGUAGE : 'en'
  }));
  return { ...entry, senses, ...senses[0] };
}

export class DictionaryApiError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = 'DictionaryApiError';
    this.code = code;
  }
}

export function normalizeQuery(word) {
  const clean = String(word || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) throw new DictionaryApiError('Enter a word to look up.', 'INVALID_WORD');
  if (clean.length > 100 || !/^[\p{L}'’\- ]+$/u.test(clean)) {
    throw new DictionaryApiError('Use letters, spaces, apostrophes, or hyphens only.', 'INVALID_WORD');
  }
  return clean;
}

function normalizeDefinition(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function sourceLabels(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map(item => String(typeof item === 'object' ? item?.text || item?.name || '' : item).trim()).filter(Boolean);
}

function sensePenalty(sense) {
  const labels = (sense.labels || []).join(' ').toLowerCase();
  return (/\b(?:obsolete|archaic|dated|historical)\b/.test(labels) ? 100 : 0)
    + (/\b(?:form-of|alt-of|inflection-of)\b/.test(labels)
      || /^(?:(?:alternative|obsolete|archaic|nonstandard) (?:form|spelling) of|(?:simple past|past participle|present participle|plural|comparative(?: form)?|superlative(?: form)?|inflection) of)\b/i.test(sense.definition) ? 80 : 0)
    + (/\b(?:rare|uncommon)\b/.test(labels) ? 30 : 0)
    + (/\b(?:technical|botany|zoology|chemistry|physics|mathematics|linguistics|medicine|anatomy)\b/.test(labels) ? 10 : 0);
}

function distinctSenses(senses, word) {
  const seen = new Map();
  const cleaned = [];
  for (const sense of senses) {
    const definition = String(sense?.definition || '').trim();
    if (!definition) continue;
    const partOfSpeech = String(sense.partOfSpeech || 'word').trim().toLowerCase();
    const key = `${partOfSpeech}|${normalizeDefinition(definition)}`;
    const labels = [...new Set([...sourceLabels(sense.tags), ...sourceLabels(sense.labels), ...sourceLabels(sense.categories)])];
    const candidate = {
      id: sense.id || `sense-${cleaned.length}`,
      partOfSpeech,
      definition,
      sourceDefinition: definition,
      ...(Array.isArray(sense.sourceDefinitions) ? { sourceDefinitions: sense.sourceDefinitions } : {}),
      labels,
      usageNote: String(sense.usageNote || '').trim(),
      sourceUrl: sense.sourceUrl || '',
      attribution: sense.attribution || '',
      example: String(sense.example || '').trim(),
      synonyms: [...new Set((sense.synonyms || []).filter(Boolean))].slice(0, 6),
      antonyms: [...new Set((sense.antonyms || []).filter(Boolean))].slice(0, 6)
    };
    if (seen.has(key)) {
      const index = seen.get(key);
      if (sensePenalty(candidate) < sensePenalty(cleaned[index])) cleaned[index] = { ...candidate, id: cleaned[index].id };
    } else { seen.set(key, cleaned.length); cleaned.push(candidate); }
  }
  if (!cleaned.length) {
    throw new DictionaryApiError(`No usable definition was returned for “${word}”.`, 'BAD_RESPONSE');
  }
  const current = cleaned.filter(sense => sensePenalty(sense) < 80);
  const ranked = (current.length ? current : cleaned).sort((left, right) => sensePenalty(left) - sensePenalty(right));
  return groupSimilarSenses(sanitizeExistingExamples(word, ranked).map(sense => ({ ...sense,
    example: isModernUsageExample(word, sense.example) ? sense.example : '',
    needsExample: !isModernUsageExample(word, sense.example) })), { word }).slice(0, 30);
}

function finishResult(word, phonetic, audioUrl, senses, source) {
  const firstSense = senses[0];
  return {
    word,
    phonetic: phonetic || '',
    audioUrl: audioUrl || '',
    senses,
    ...firstSense,
    imageUrl: '',
    source
  };
}

function cachedResult(data, cleanWord) {
  const word = data.word || cleanWord;
  const senses = distinctSenses(Array.isArray(data.senses) ? data.senses : [data], word);
  return { ...data, senses, ...senses[0], source: 'cache' };
}

function parseLegacyEntries(payload, cleanWord) {
  const entries = payload.filter(entry => entry && Array.isArray(entry.meanings));
  if (!entries.length) return null;
  const phonetics = entries.flatMap(entry => Array.isArray(entry.phonetics) ? entry.phonetics : []);
  const phonetic = entries.find(entry => entry.phonetic)?.phonetic || phonetics.find(item => item?.text)?.text || '';
  let audioUrl = phonetics.find(item => item?.audio)?.audio || '';
  if (audioUrl.startsWith('//')) audioUrl = `https:${audioUrl}`;
  const senses = entries.flatMap(entry => entry.meanings.flatMap(meaning =>
    (meaning?.definitions || []).map(item => ({
      partOfSpeech: meaning.partOfSpeech,
      definition: item?.definition,
      example: item?.example,
      tags: [...sourceLabels(meaning.tags), ...sourceLabels(item?.tags)],
      labels: [...sourceLabels(meaning.labels), ...sourceLabels(item?.labels)],
      synonyms: [...(meaning.synonyms || []), ...(item?.synonyms || [])],
      antonyms: [...(meaning.antonyms || []), ...(item?.antonyms || [])]
    }))
  ));
  const word = String(entries[0].word || cleanWord).toLowerCase();
  return finishResult(word, phonetic, audioUrl, distinctSenses(senses, word), 'dictionary');
}

function flattenFreeApiSense(entry, sense, inherited = {}) {
  const examples = [...(sense?.examples || []), ...(sense?.quotes || []).map(quote => quote?.text || '')];
  const example = examples.find(value => isModernUsageExample({ word: entry.lookupWord, partOfSpeech: entry.partOfSpeech }, value)) || '';
  const current = {
    partOfSpeech: entry.partOfSpeech,
    definition: sense?.definition,
    example,
    tags: [...sourceLabels(inherited.tags), ...sourceLabels(sense?.tags)],
    labels: [...sourceLabels(inherited.labels), ...sourceLabels(sense?.labels)],
    categories: [...sourceLabels(inherited.categories), ...sourceLabels(sense?.categories)],
    sourceUrl: inherited.sourceUrl,
    attribution: inherited.attribution,
    synonyms: [...(inherited.synonyms || []), ...(sense?.synonyms || [])],
    antonyms: [...(inherited.antonyms || []), ...(sense?.antonyms || [])]
  };
  return [current, ...(sense?.subsenses || []).flatMap(subsense => flattenFreeApiSense(entry, subsense, current))];
}

function parseFreeDictionary(payload, cleanWord) {
  if (Array.isArray(payload)) return parseLegacyEntries(payload, cleanWord);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (!entries.length) return null;
  const pronunciation = entries.flatMap(entry => entry.pronunciations || []).find(item => item?.text)?.text || '';
  const senses = entries.flatMap(entry => (entry.senses || []).flatMap(sense => flattenFreeApiSense({ ...entry, lookupWord: payload.word || cleanWord }, sense, { ...entry,
    sourceUrl: payload.source?.url || '', attribution: payload.source?.license?.name || '' })));
  const word = String(payload.word || cleanWord).toLowerCase();
  return finishResult(word, pronunciation, '', distinctSenses(senses, word), 'freedictionaryapi.com');
}

function parseDatamuse(payload, cleanWord) {
  const exact = (Array.isArray(payload) ? payload : []).find(item =>
    String(item?.word || '').toLowerCase() === cleanWord && Array.isArray(item.defs) && item.defs.length
  );
  if (!exact) return null;
  const senses = exact.defs.map(definition => {
    const [rawPart, ...definitionParts] = String(definition).split('\t');
    const partMap = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: 'word' };
    return {
      partOfSpeech: partMap[rawPart] || rawPart || 'word',
      definition: definitionParts.join(' ').trim()
    };
  });
  return finishResult(cleanWord, '', '', distinctSenses(senses, cleanWord), 'datamuse');
}

async function requestJson(url, fetchImpl, timeoutMs, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (response.status === 404) throw new DictionaryApiError('Not found.', 'NOT_FOUND');
    if (!response.ok) throw new DictionaryApiError(`Dictionary service returned HTTP ${response.status}.`, 'HTTP');
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }
}

async function lookupPrimary(cleanWord, fetchImpl, timeoutMs) {
  const payload = await requestJson(`${PRIMARY_API_BASE}${encodeURIComponent(cleanWord)}`, fetchImpl, timeoutMs);
  const result = parseFreeDictionary(payload, cleanWord);
  if (!result) throw new DictionaryApiError(`“${cleanWord}” was not found in the dictionary.`, 'NOT_FOUND');
  return result;
}

async function lookupFallback(cleanWord, fetchImpl, timeoutMs) {
  const url = new URL(FALLBACK_API_BASE);
  url.searchParams.set('sp', cleanWord);
  url.searchParams.set('md', 'd');
  url.searchParams.set('max', '3');
  const payload = await requestJson(url.toString(), fetchImpl, timeoutMs);
  const result = parseDatamuse(payload, cleanWord);
  if (!result) throw new DictionaryApiError(`“${cleanWord}” was not found in the dictionary.`, 'NOT_FOUND');
  return result;
}

export async function fetchWordDetails(word, options = {}) {
  const cleanWord = normalizeQuery(word);
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const cache = readObjectCache(storage, CACHE_KEY);

  if (!options.force && cacheEntryIsFresh(cache[cleanWord], options.cacheTtlMs || CACHE_TTL_MS)) {
    return cachedResult(cache[cleanWord].data, cleanWord);
  }

  if (!fetchImpl) {
    if (cache[cleanWord]?.data) return cachedResult(cache[cleanWord].data, cleanWord);
    throw new DictionaryApiError('Dictionary lookup is unavailable in this browser.', 'NETWORK');
  }

  let primaryError;
  let fallbackError;
  let result;
  try {
    result = await lookupPrimary(cleanWord, fetchImpl, Math.min(timeoutMs, PRIMARY_TIMEOUT_MS));
  } catch (error) {
    primaryError = error;
    try {
      result = await lookupFallback(cleanWord, fetchImpl, Math.min(timeoutMs, FALLBACK_TIMEOUT_MS));
    } catch (fallback) {
      fallbackError = fallback;
    }
  }

  if (!result) {
    if (cache[cleanWord]?.data) return cachedResult(cache[cleanWord].data, cleanWord);
    if (fallbackError instanceof DictionaryApiError && fallbackError.code === 'NOT_FOUND') {
      throw new DictionaryApiError(`“${cleanWord}” was not found in the dictionary.`, 'NOT_FOUND', primaryError);
    }
    throw new DictionaryApiError(
      'Could not reach a dictionary service. Check your connection and try again.',
      'NETWORK',
      fallbackError || primaryError
    );
  }

  if (result.word !== cleanWord) result = { ...result, correctedFrom: cleanWord };
  cache[cleanWord] = { cachedAt: Date.now(), data: result };
  if (result.word !== cleanWord) cache[result.word] = { cachedAt: Date.now(), data: result };
  writeRecentObjectCache(storage, CACHE_KEY, cache, CACHE_MAX_ENTRIES);
  return result;
}
