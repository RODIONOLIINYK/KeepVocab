import { generateGeminiContent, getGeminiSettings } from './geminiSettings.js?v=113';
import { fetchLithuanianWordDetails } from './lithuanianDictionary.js?v=101';
import { cacheEntryIsFresh, readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=117';

const coachTranslationCache = new Map();
const COACH_TRANSLATION_CACHE_LIMIT = 120;
const ENTRY_CACHE_KEY = 'keepvocab_lithuanian_ai_entry_cache_v1';
const ENTRY_CACHE_LIMIT = 120;
const ENTRY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function translateLithuanianCoachText(text, options = {}) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  if (coachTranslationCache.has(source)) return coachTranslationCache.get(source);
  const translation = String(await generateGeminiContent(`Translate this Lithuanian speaking-coach message into clear, natural English.
Preserve the meaning, question, tone, names, and numbers. Return only the English translation—no label, quotation marks, notes, or Lithuanian text.

Lithuanian: ${JSON.stringify(source)}`, { ...options, maxOutputTokens: 220 }) || '').trim().replace(/^['“"]|['”"]$/g, '');
  if (!translation) throw new Error('No English translation was returned.');
  coachTranslationCache.set(source, translation);
  while (coachTranslationCache.size > COACH_TRANSLATION_CACHE_LIMIT) {
    coachTranslationCache.delete(coachTranslationCache.keys().next().value);
  }
  return translation;
}

export async function enrichLithuanianEntry(term, options = {}) {
  const word = String(term || '').trim();
  if (!word) throw new Error('Enter a Lithuanian word or phrase.');
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const settings = getGeminiSettings(storage);
  if (!settings.apiKey) throw new Error('Gemini is not configured. Enter the translation and forms manually, or add a key in Settings.');
  const cache = readObjectCache(storage, ENTRY_CACHE_KEY);
  const cacheKey = `${settings.textModel}|${word.toLocaleLowerCase('lt-LT').replace(/\s+/g, ' ')}`;
  if (!options.force && cacheEntryIsFresh(cache[cacheKey], options.cacheTtlMs || ENTRY_CACHE_TTL_MS)) return cache[cacheKey].data;
  const result = await generateGeminiContent(`Return JSON for this Lithuanian learner entry: ${JSON.stringify(word)}.
Use English for explanations. Do not invent a word if the spelling is invalid.
Shape: {"word":"correct Lithuanian headword","lemma":"dictionary lemma","phonetic":"optional simple stress-friendly pronunciation note","senses":[{"id":"stable short id","partOfSpeech":"noun/verb/adjective/phrase/etc","definition":"concise English translation","example":"short natural Lithuanian example","acceptedForms":["headword and useful inflected forms"],"grammaticalTags":["gender/case/conjugation information"]}]}
Return 1–3 genuinely distinct senses. Keep examples at A1–A2 where possible.`, { ...options, json: true, maxOutputTokens: 900 });
  if (!result || !Array.isArray(result.senses) || !result.senses.length) throw new Error('Gemini returned no usable Lithuanian entry.');
  const entry = {
    word: String(result.word || word).trim(),
    lemma: String(result.lemma || result.word || word).trim(),
    phonetic: String(result.phonetic || '').trim(),
    aiGenerated: true,
    senses: result.senses.map((sense, index) => ({
      id: String(sense.id || `lt-${index + 1}`),
      partOfSpeech: String(sense.partOfSpeech || 'word'),
      definition: String(sense.definition || '').trim(),
      translation: String(sense.definition || '').trim(),
      example: String(sense.example || '').trim(),
      acceptedForms: [...new Set([result.word || word, ...(sense.acceptedForms || [])].map(value => String(value || '').trim()).filter(Boolean))],
      grammaticalTags: [...new Set((sense.grammaticalTags || []).map(value => String(value || '').trim()).filter(Boolean))],
      source: 'Gemini suggestion — confirm before saving'
    })).filter(sense => sense.definition)
  };
  cache[cacheKey] = { cachedAt: Date.now(), data: entry };
  writeRecentObjectCache(storage, ENTRY_CACHE_KEY, cache, ENTRY_CACHE_LIMIT);
  return entry;
}

function mergeDictionaryWithAi(dictionary, ai) {
  const aiSenses = Array.isArray(ai?.senses) ? ai.senses : [];
  return {
    ...dictionary,
    lemma: ai?.lemma || dictionary.lemma,
    senses: dictionary.senses.map(sense => {
      const supplement = aiSenses.find(item => item.partOfSpeech === sense.partOfSpeech) || aiSenses[0];
      if (!supplement) return sense;
      return {
        ...sense,
        example: supplement.example || sense.example,
        acceptedForms: [...new Set([...(sense.acceptedForms || []), ...(supplement.acceptedForms || [])])],
        grammaticalTags: [...new Set([...(sense.grammaticalTags || []), ...(supplement.grammaticalTags || [])])],
        source: 'Wiktionary · AI-enriched forms'
      };
    }),
    aiEnriched: true
  };
}

export async function fetchLithuanianEntry(term, options = {}) {
  let dictionary;
  let dictionaryError;
  try {
    dictionary = await fetchLithuanianWordDetails(term, options);
  } catch (error) {
    dictionaryError = error;
  }

  if (!getGeminiSettings(options.storage).apiKey) {
    if (dictionary) return dictionary;
    throw dictionaryError;
  }

  try {
    const ai = await enrichLithuanianEntry(term, options);
    return dictionary ? mergeDictionaryWithAi(dictionary, ai) : ai;
  } catch (aiError) {
    if (dictionary) return { ...dictionary, enrichmentWarning: aiError.message };
    throw dictionaryError || aiError;
  }
}
