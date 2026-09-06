import { cacheEntryIsFresh, readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=1602';

const API_BASE = 'https://en.wiktionary.org/w/rest.php/v1/page/';
const CACHE_KEY = 'keepvocab_lithuanian_dictionary_cache_v1';
const CACHE_LIMIT = 180;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4500;

const PARTS_OF_SPEECH = new Set([
  'adjective', 'adverb', 'conjunction', 'determiner', 'interjection', 'noun',
  'numeral', 'particle', 'phrase', 'postposition', 'preposition', 'pronoun',
  'proper noun', 'verb'
]);

export class LithuanianDictionaryError extends Error {
  constructor(message, code = 'LOOKUP_FAILED', cause) {
    super(message, { cause });
    this.name = 'LithuanianDictionaryError';
    this.code = code;
  }
}

function normalizeTerm(term) {
  const clean = String(term || '').trim().toLocaleLowerCase('lt-LT').replace(/\s+/g, ' ');
  if (!clean) throw new LithuanianDictionaryError('Enter a Lithuanian word or phrase.', 'INVALID_WORD');
  if (clean.length > 100 || !/^[\p{L}'’\- ]+$/u.test(clean)) {
    throw new LithuanianDictionaryError('Use Lithuanian letters, spaces, apostrophes, or hyphens only.', 'INVALID_WORD');
  }
  return clean;
}

function decodeHtml(value) {
  const entities = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
    .replace(/&([a-z]+);/gi, (_, name) => entities[name.toLowerCase()] ?? `&${name};`)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function sectionBetween(html, headingLevel, headingId) {
  const marker = new RegExp(`<h${headingLevel}[^>]*id=["']${headingId}["'][^>]*>`, 'i');
  const match = marker.exec(html);
  if (!match) return '';
  const start = match.index + match[0].length;
  const nextHeading = new RegExp(`<h[1-${headingLevel}][^>]*>`, 'i').exec(html.slice(start));
  return html.slice(start, nextHeading ? start + nextHeading.index : html.length);
}

function firstMatch(html, expression) {
  const match = expression.exec(html);
  return match ? decodeHtml(match[1]) : '';
}

function extractDefinitions(section) {
  const listStart = section.search(/<ol\b/i);
  if (listStart < 0) return [];
  const listEnd = section.indexOf('</ol>', listStart);
  const list = section.slice(listStart, listEnd < 0 ? section.length : listEnd + 5);
  const definitions = [];
  const itemExpression = /<li\b[^>]*>([\s\S]*?)(?=<li\b|<\/ol>)/gi;
  for (const match of list.matchAll(itemExpression)) {
    const definition = decodeHtml(match[1])
      .replace(/\s+(?:Synonyms?|Antonyms?|Coordinate terms?):.*$/i, '')
      .replace(/\s+(synonyms?|antonyms?|coordinate terms?)\s*[▲▼]?\s*$/i, '')
      .trim();
    if (definition && !definitions.includes(definition)) definitions.push(definition);
  }
  return definitions.slice(0, 8);
}

export function parseLithuanianWiktionaryHtml(html, term) {
  const cleanTerm = normalizeTerm(term);
  const lithuanian = sectionBetween(String(html || ''), 2, 'Lithuanian');
  if (!lithuanian) return null;
  const headingExpression = /<h3[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/h3>/gi;
  const headings = [...lithuanian.matchAll(headingExpression)];
  const phonetic = firstMatch(lithuanian, /<span[^>]*class=["'][^"']*\bIPA\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  const senses = [];

  headings.forEach((heading, index) => {
    const title = decodeHtml(heading[2]).replace(/_/g, ' ').replace(/\s+\d+$/, '').trim().toLowerCase();
    if (!PARTS_OF_SPEECH.has(title)) return;
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : lithuanian.length;
    const section = lithuanian.slice(start, end);
    const lemma = firstMatch(section, /<strong[^>]*class=["'][^"']*\bheadword\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i) || cleanTerm;
    const headwordLine = firstMatch(section, /<span[^>]*class=["'][^"']*\bheadword-line\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const tags = headwordLine
      .replace(lemma, '')
      .split(/[,;()]/)
      .map(tag => tag.trim())
      .filter(tag => tag && tag.length < 48)
      .slice(0, 5);
    extractDefinitions(section).forEach(definition => {
      senses.push({
        id: `lt-wikt-${senses.length + 1}`,
        partOfSpeech: title,
        definition,
        translation: definition,
        example: '',
        acceptedForms: [cleanTerm],
        grammaticalTags: tags,
        lemma,
        source: 'Wiktionary',
        sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(cleanTerm)}#Lithuanian`,
        attribution: 'Wiktionary contributors · CC BY-SA 4.0'
      });
    });
  });

  if (!senses.length) return null;
  return {
    word: cleanTerm,
    lemma: senses[0].lemma || cleanTerm,
    phonetic,
    audioUrl: '',
    senses,
    source: 'Wiktionary',
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(cleanTerm)}#Lithuanian`,
    attribution: 'Wiktionary contributors · CC BY-SA 4.0'
  };
}

export async function fetchLithuanianWordDetails(term, options = {}) {
  const cleanTerm = normalizeTerm(term);
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const cache = readObjectCache(storage, CACHE_KEY);
  if (!options.force && cacheEntryIsFresh(cache[cleanTerm], options.cacheTtlMs || CACHE_TTL_MS)) {
    return { ...cache[cleanTerm].data, source: 'Wiktionary cache' };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    if (cache[cleanTerm]?.data) return { ...cache[cleanTerm].data, source: 'Wiktionary cache' };
    throw new LithuanianDictionaryError('Lithuanian dictionary lookup is unavailable offline.', 'NETWORK');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${API_BASE}${encodeURIComponent(cleanTerm)}/with_html`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (response.status === 404) throw new LithuanianDictionaryError(`“${cleanTerm}” was not found in the Lithuanian dictionary.`, 'NOT_FOUND');
    if (!response.ok) throw new LithuanianDictionaryError(`Lithuanian dictionary returned HTTP ${response.status}.`, 'HTTP');
    const payload = await response.json();
    const result = parseLithuanianWiktionaryHtml(payload?.html, cleanTerm);
    if (!result) throw new LithuanianDictionaryError(`No Lithuanian definition was found for “${cleanTerm}”.`, 'NOT_FOUND');
    cache[cleanTerm] = { cachedAt: Date.now(), data: result };
    writeRecentObjectCache(storage, CACHE_KEY, cache, CACHE_LIMIT);
    return result;
  } catch (error) {
    if (cache[cleanTerm]?.data) return { ...cache[cleanTerm].data, source: 'Wiktionary cache' };
    if (error instanceof LithuanianDictionaryError) throw error;
    throw new LithuanianDictionaryError('Could not reach the Lithuanian dictionary. Check your connection and try again.', 'NETWORK', error);
  } finally {
    clearTimeout(timeoutId);
  }
}
