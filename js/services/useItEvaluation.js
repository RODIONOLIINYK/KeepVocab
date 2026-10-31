import { generateGeminiContent, getGeminiSettings } from './geminiSettings.js?v=18900';
import { sentenceUsesTargetForm, targetWordForms } from '../utils/wordForms.js?v=18900';
import { getTranslationName, isUkrainianTranslationEnabled } from './translationSettings.js?v=18900';
import { readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=18900';

const USE_IT_CACHE_KEY = 'keepvocab_use_it_eval_cache_v1';
const WORD_CHECK_FEEDBACK = /(?:include|insert|use|write|contain).{0,35}(?:target|headword|word|\b[a-z][a-z'-]*\b).{0,25}(?:sentence|exact|form)|(?:missing|does not contain).{0,25}(?:target|headword|word)/i;

function safeFeedback(result, correct) {
  const feedback = String(result?.feedback || '').trim();
  if (!feedback || WORD_CHECK_FEEDBACK.test(feedback)) {
    return correct
      ? 'The sentence clearly communicates the saved meaning.'
      : 'Rewrite the sentence so it clearly expresses the saved meaning and sounds natural.';
  }
  return feedback;
}

export function evaluateUseItFallback(word, sentence) {
  const hasSentence = Boolean(String(sentence || '').trim());
  return {
    used: sentenceUsesTargetForm(sentence, word),
    senseCorrect: null,
    grammatical: null,
    natural: null,
    correct: hasSentence,
    feedback: hasSentence
      ? 'Your sentence is saved. Connect Gemini for meaning, grammar, and naturalness feedback.'
      : 'Write a sentence before checking.',
    improvedSentence: '',
    evaluatedBy: 'local-save'
  };
}

export async function evaluateUseItSentence(word, sentence, options = {}) {
  const fallback = evaluateUseItFallback(word, sentence);
  const settings = { ...getGeminiSettings(options.storage), ...(options.settings || {}) };
  if (!fallback.correct || !settings.enabled) return fallback;
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const normalizedSentence = String(sentence || '').trim().replace(/\s+/g, ' ');
  const cacheKey = JSON.stringify([settings.textModel, getTranslationName(storage), String(word.word || '').trim().toLowerCase(),
    String(word.partOfSpeech || '').trim().toLowerCase(), String(word.definition || '').trim(), normalizedSentence]);
  const cached = !options.force && readObjectCache(storage, USE_IT_CACHE_KEY)[cacheKey]?.data;
  if (cached && typeof cached === 'object') return { ...cached, used: fallback.used || cached.used || cached.correct };

  try {
    const result = await generateGeminiContent(`You are a concise, encouraging English teacher evaluating whether a learner used a vocabulary meaning naturally.

Dictionary headword: ${word.word}
Saved meaning: ${word.definition}
${isUkrainianTranslationEnabled(options.storage) && word.translationLanguage === 'uk' && word.translation ? `Ukrainian translation of this meaning: ${word.translation}` : ''}
Part of speech on the saved card: ${word.partOfSpeech || 'not specified'}
Example for the saved meaning: ${word.example || 'not provided'}
Common related grammatical spellings: ${targetWordForms(word).join(', ')}
Learner sentence: ${sentence}

Preferred meaning-hint language: ${getTranslationName(options.storage)}. Keep feedback and improvedSentence in English. Use any supplied translation only to understand the saved meaning.

Judge meaning, grammar, and naturalness. Do not perform an exact-word or substring check. A learner may correctly change number, possessive, third-person, past-tense, participle, gerund, comparative, superlative, or part of speech when the resulting sentence still expresses the saved lexical meaning; never require the exact headword spelling when grammar calls for a related form. For example, a noun card "cuddle" may be used as "cuddled", and "pest" may be used as "pests". Do not reject a good sentence merely because its spelling differs from the headword. If the sentence expresses another meaning of the same spelling, mark senseCorrect false. Feedback must discuss meaning, grammar, or naturalness; never instruct the learner to insert the exact headword.

Return JSON only with: used (boolean), senseCorrect (boolean), grammatical (boolean), natural (boolean), correct (boolean; true when the saved meaning is communicated in an understandable sentence), feedback (one short sentence), improvedSentence (empty when no improvement is needed).`, { ...options, json: true, maxOutputTokens: 320 });

    const localUsed = fallback.used;
    const modelUsed = Boolean(result.used);
    const senseCorrect = Boolean(result.senseCorrect);
    const grammatical = Boolean(result.grammatical);
    const natural = Boolean(result.natural);
    const modelCorrect = Boolean(result.correct);
    const correct = modelCorrect || (localUsed && senseCorrect && grammatical);

    const evaluated = {
      used: localUsed || modelUsed || correct,
      senseCorrect,
      grammatical,
      natural,
      correct,
      feedback: safeFeedback(result, correct),
      improvedSentence: String(result.improvedSentence || ''),
      evaluatedBy: 'gemini'
    };
    const cache = readObjectCache(storage, USE_IT_CACHE_KEY);
    cache[cacheKey] = { cachedAt: Date.now(), data: evaluated };
    writeRecentObjectCache(storage, USE_IT_CACHE_KEY, cache, 160);
    return evaluated;
  } catch {
    return fallback;
  }
}
