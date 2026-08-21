import { generateGeminiContent, getGeminiSettings } from './geminiSettings.js?v=90';
import { sentenceUsesTargetForm, targetWordForms } from '../utils/wordForms.js?v=90';

const WORD_CHECK_FEEDBACK = /(?:include|insert|use|write|contain).{0,35}(?:target|headword|word|\b[a-z][a-z'-]*\b).{0,25}(?:sentence|exact|form)|(?:missing|does not contain).{0,25}(?:target|headword|word)/i;

function safeFeedback(result, correct, fallback) {
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
  if (!fallback.correct || !getGeminiSettings(options.storage).enabled) return fallback;

  try {
    const result = await generateGeminiContent(`You are a concise, encouraging English teacher evaluating whether a learner used a vocabulary meaning naturally.

Dictionary headword: ${word.word}
Saved meaning: ${word.definition}
Part of speech on the saved card: ${word.partOfSpeech || 'not specified'}
Example for the saved meaning: ${word.example || 'not provided'}
Common related grammatical spellings: ${targetWordForms(word).join(', ')}
Learner sentence: ${sentence}

Judge meaning, grammar, and naturalness. Do not perform an exact-word or substring check. A learner may correctly change number, possessive, third-person, past-tense, participle, gerund, comparative, superlative, or part of speech when the resulting sentence still expresses the saved lexical meaning; never require the exact headword spelling when grammar calls for a related form. For example, a noun card "cuddle" may be used as "cuddled", and "pest" may be used as "pests". Do not reject a good sentence merely because its spelling differs from the headword. If the sentence expresses another meaning of the same spelling, mark senseCorrect false. Feedback must discuss meaning, grammar, or naturalness; never instruct the learner to insert the exact headword.

Return JSON only with: used (boolean), senseCorrect (boolean), grammatical (boolean), natural (boolean), correct (boolean; true when the saved meaning is communicated in an understandable sentence), feedback (one short sentence), improvedSentence (empty when no improvement is needed).`, { ...options, json: true });

    const localUsed = fallback.used;
    const modelUsed = Boolean(result.used);
    const senseCorrect = Boolean(result.senseCorrect);
    const grammatical = Boolean(result.grammatical);
    const natural = Boolean(result.natural);
    const modelCorrect = Boolean(result.correct);
    const correct = modelCorrect || (localUsed && senseCorrect && grammatical);

    return {
      used: localUsed || modelUsed || correct,
      senseCorrect,
      grammatical,
      natural,
      correct,
      feedback: safeFeedback(result, correct, fallback.feedback),
      improvedSentence: String(result.improvedSentence || ''),
      evaluatedBy: 'gemini'
    };
  } catch {
    return fallback;
  }
}
