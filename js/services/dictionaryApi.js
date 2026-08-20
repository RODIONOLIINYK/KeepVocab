// Free Dictionary API client with validation, examples, timeout, and an offline cache.

import { fetchExamplesForSenses, sanitizeExistingExamples } from './exampleSearch.js?v=79';

const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const SPELLING_API_BASE = 'https://api.languagetool.org/v2/check';
const SPELLING_FALLBACK_API_BASE = 'https://api.datamuse.com/sug';
const CACHE_KEY = 'keepvocab_dictionary_cache_v3';
const CACHE_MAX_ENTRIES = 250;

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

function readCache(storage) {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(storage, cache) {
  if (!storage) return;
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => (b.cachedAt || 0) - (a.cachedAt || 0))
    .slice(0, CACHE_MAX_ENTRIES);
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // A full or privacy-restricted storage area should not break lookup.
  }
}

function normalizeDefinition(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function damerauLevenshtein(leftValue, rightValue) {
  const left = String(leftValue || '').toLowerCase();
  const right = String(rightValue || '').toLowerCase();
  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function credibleCorrection(original, suggestions) {
  const maxDistance = original.length <= 4 ? 1 : original.length <= 8 ? 2 : 3;
  return (suggestions || [])
    .map(item => String(item?.word || item?.value || '').trim().toLowerCase())
    .filter(word => word && word !== original && /^[\p{L}'’\- ]+$/u.test(word))
    .map(word => ({ word, distance: damerauLevenshtein(original, word) }))
    .filter(item => item.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance)[0]?.word || '';
}

async function findSpellingCorrection(cleanWord, fetchImpl, signal) {
  try {
    const response = await fetchImpl(SPELLING_API_BASE, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text: cleanWord, language: 'en-US' }).toString(),
      signal
    });
    if (response.ok) {
      const payload = await response.json();
      const replacements = (payload?.matches || [])
        .filter(match => match?.rule?.issueType === 'misspelling' || match?.rule?.id === 'MORFOLOGIK_RULE_EN_US')
        .flatMap(match => match.replacements || []);
      const correction = credibleCorrection(cleanWord, replacements);
      if (correction) return correction;
    }
  } catch {
    // Fall through to the lighter spelling suggestion service.
  }

  try {
    const suggestionUrl = new URL(SPELLING_FALLBACK_API_BASE);
    suggestionUrl.searchParams.set('s', cleanWord);
    suggestionUrl.searchParams.set('max', '5');
    const response = await fetchImpl(suggestionUrl.toString(), { headers: { Accept: 'application/json' }, signal });
    return response.ok ? credibleCorrection(cleanWord, await response.json()) : '';
  } catch {
    return '';
  }
}

function parseEntries(entries, cleanWord) {
  const usableEntries = entries.filter(entry => entry && Array.isArray(entry.meanings));
  if (usableEntries.length === 0) {
    throw new DictionaryApiError(`No usable definition was returned for “${cleanWord}”.`, 'BAD_RESPONSE');
  }

  const phonetics = usableEntries.flatMap(entry => Array.isArray(entry.phonetics) ? entry.phonetics : []);
  const phonetic = usableEntries.find(entry => entry.phonetic)?.phonetic || phonetics.find(item => item?.text)?.text || '';
  let audioUrl = phonetics.find(item => item?.audio)?.audio || '';
  if (audioUrl.startsWith('//')) audioUrl = `https:${audioUrl}`;

  const senses = [];
  const seen = new Set();
  usableEntries.forEach((entry, entryIndex) => {
    entry.meanings.forEach((meaning, meaningIndex) => {
      if (!Array.isArray(meaning?.definitions)) return;
      meaning.definitions.forEach((item, definitionIndex) => {
        const definition = String(item?.definition || '').trim();
        if (!definition) return;
        const partOfSpeech = String(meaning.partOfSpeech || 'unknown').trim().toLowerCase();
        const key = `${partOfSpeech}|${normalizeDefinition(definition)}`;
        if (seen.has(key)) return;
        seen.add(key);
        senses.push({
          id: `${entryIndex}-${meaningIndex}-${definitionIndex}`,
          partOfSpeech,
          definition,
          example: String(item.example || '').trim(),
          synonyms: [...new Set([...(meaning.synonyms || []), ...(item.synonyms || [])].filter(Boolean))].slice(0, 6),
          antonyms: [...new Set([...(meaning.antonyms || []), ...(item.antonyms || [])].filter(Boolean))].slice(0, 6)
        });
      });
    });
  });

  if (senses.length === 0) {
    throw new DictionaryApiError(`No usable definition was returned for “${cleanWord}”.`, 'BAD_RESPONSE');
  }

  const cleanedSenses = sanitizeExistingExamples(cleanWord, senses);
  const firstSense = cleanedSenses[0];
  return {
    word: String(usableEntries[0].word || cleanWord).toLowerCase(),
    phonetic,
    audioUrl,
    senses: cleanedSenses.slice(0, 30),
    ...firstSense,
    imageUrl: '',
    source: 'dictionaryapi.dev'
  };
}

export async function fetchWordDetails(word, options = {}) {
  const cleanWord = normalizeQuery(word);
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const timeoutMs = options.timeoutMs || 8000;
  const cache = readCache(storage);

  if (!fetchImpl) {
    if (cache[cleanWord]?.data) return { ...cache[cleanWord].data, source: 'cache' };
    throw new DictionaryApiError('Dictionary lookup is unavailable in this browser.', 'NETWORK');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let resolvedWord = cleanWord;
    let response = await fetchImpl(`${DICTIONARY_API_BASE}${encodeURIComponent(cleanWord)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (response.status === 404) {
      try {
        const suggestion = await findSpellingCorrection(cleanWord, fetchImpl, controller.signal);
        if (suggestion) {
          const correctedResponse = await fetchImpl(`${DICTIONARY_API_BASE}${encodeURIComponent(suggestion)}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal
          });
          if (correctedResponse.ok) {
            resolvedWord = suggestion;
            response = correctedResponse;
          }
        }
      } catch {
        // Preserve the original not-found result when the spelling helper is unavailable.
      }
      if (response.status === 404) {
        throw new DictionaryApiError(`“${cleanWord}” was not found in the dictionary.`, 'NOT_FOUND');
      }
    }
    if (!response.ok) {
      throw new DictionaryApiError(`Dictionary service returned HTTP ${response.status}.`, 'HTTP');
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new DictionaryApiError(`No dictionary entry was returned for “${cleanWord}”.`, 'BAD_RESPONSE');
    }

    let result = parseEntries(payload, resolvedWord);
    if (resolvedWord !== cleanWord) result = { ...result, correctedFrom: cleanWord };
    const exampleFetchImpl = options.exampleFetchImpl ?? (options.fetchImpl ? null : globalThis.fetch?.bind(globalThis));
    if (exampleFetchImpl) {
      const senses = await fetchExamplesForSenses(result.word, result.senses, exampleFetchImpl);
      result = { ...result, senses, ...senses[0] };
    }
    cache[cleanWord] = { cachedAt: Date.now(), data: result };
    if (resolvedWord !== cleanWord) cache[resolvedWord] = { cachedAt: Date.now(), data: result };
    writeCache(storage, cache);
    return result;
  } catch (error) {
    if (error instanceof DictionaryApiError) throw error;
    if (cache[cleanWord]?.data) return { ...cache[cleanWord].data, source: 'cache' };
    if (error?.name === 'AbortError') {
      throw new DictionaryApiError('Dictionary lookup timed out. Try again.', 'TIMEOUT', error);
    }
    throw new DictionaryApiError('Could not reach the dictionary service. Check your connection and try again.', 'NETWORK', error);
  } finally {
    clearTimeout(timeoutId);
  }
}
