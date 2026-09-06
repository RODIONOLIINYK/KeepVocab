// Fast dictionary lookup with a maintained Wiktionary source, a short fallback, and offline cache.

import { sanitizeExistingExamples } from './exampleSearch.js?v=1602';
import { cacheEntryIsFresh, readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=1602';

const PRIMARY_API_BASE = 'https://freedictionaryapi.com/api/v1/entries/en/';
const FALLBACK_API_BASE = 'https://api.datamuse.com/words';
const CACHE_KEY = 'keepvocab_dictionary_cache_v4';
const CACHE_MAX_ENTRIES = 250;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3200;
const PRIMARY_TIMEOUT_MS = 2200;
const FALLBACK_TIMEOUT_MS = 1600;

export class DictionaryApiError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = 'DictionaryApiError';
    this.code = code;
  }
}

function normalizeQuery(word) {
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

function distinctSenses(senses, word) {
  const seen = new Set();
  const cleaned = [];
  for (const sense of senses) {
    const definition = String(sense?.definition || '').trim();
    if (!definition) continue;
    const partOfSpeech = String(sense.partOfSpeech || 'word').trim().toLowerCase();
    const key = `${partOfSpeech}|${normalizeDefinition(definition)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      id: `sense-${cleaned.length}`,
      partOfSpeech,
      definition,
      example: String(sense.example || '').trim(),
      synonyms: [...new Set((sense.synonyms || []).filter(Boolean))].slice(0, 6),
      antonyms: [...new Set((sense.antonyms || []).filter(Boolean))].slice(0, 6)
    });
  }
  if (!cleaned.length) {
    throw new DictionaryApiError(`No usable definition was returned for “${word}”.`, 'BAD_RESPONSE');
  }
  return sanitizeExistingExamples(word, cleaned).slice(0, 30);
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
      synonyms: [...(meaning.synonyms || []), ...(item?.synonyms || [])],
      antonyms: [...(meaning.antonyms || []), ...(item?.antonyms || [])]
    }))
  ));
  const word = String(entries[0].word || cleanWord).toLowerCase();
  return finishResult(word, phonetic, audioUrl, distinctSenses(senses, word), 'dictionary');
}

function flattenFreeApiSense(entry, sense, inherited = {}) {
  const example = sense?.examples?.[0] || sense?.quotes?.[0]?.text || '';
  const current = {
    partOfSpeech: entry.partOfSpeech,
    definition: sense?.definition,
    example,
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
  const senses = entries.flatMap(entry => (entry.senses || []).flatMap(sense => flattenFreeApiSense(entry, sense, entry)));
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

async function requestJson(url, fetchImpl, timeoutMs) {
  const controller = new AbortController();
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
    return { ...cache[cleanWord].data, source: 'cache' };
  }

  if (!fetchImpl) {
    if (cache[cleanWord]?.data) return { ...cache[cleanWord].data, source: 'cache' };
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
    if (cache[cleanWord]?.data) return { ...cache[cleanWord].data, source: 'cache' };
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
