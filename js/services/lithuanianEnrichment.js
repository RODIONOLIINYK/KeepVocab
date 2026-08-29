import { generateGeminiContent, getGeminiSettings } from './geminiSettings.js?v=93';
import { fetchLithuanianWordDetails } from './lithuanianDictionary.js?v=101';

export async function enrichLithuanianEntry(term, options = {}) {
  const word = String(term || '').trim();
  if (!word) throw new Error('Enter a Lithuanian word or phrase.');
  if (!getGeminiSettings(options.storage).apiKey) throw new Error('Gemini is not configured. Enter the translation and forms manually, or add a key in Settings.');
  const result = await generateGeminiContent(`Return JSON for this Lithuanian learner entry: ${JSON.stringify(word)}.
Use English for explanations. Do not invent a word if the spelling is invalid.
Shape: {"word":"correct Lithuanian headword","lemma":"dictionary lemma","phonetic":"optional simple stress-friendly pronunciation note","senses":[{"id":"stable short id","partOfSpeech":"noun/verb/adjective/phrase/etc","definition":"concise English translation","example":"short natural Lithuanian example","acceptedForms":["headword and useful inflected forms"],"grammaticalTags":["gender/case/conjugation information"]}]}
Return 1–3 genuinely distinct senses. Keep examples at A1–A2 where possible.`, { ...options, json: true, maxOutputTokens: 900 });
  if (!result || !Array.isArray(result.senses) || !result.senses.length) throw new Error('Gemini returned no usable Lithuanian entry.');
  return {
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
