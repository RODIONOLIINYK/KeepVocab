import { definitionForLearning, exampleForLearning, isModernUsageExample } from './learningDefinitions.js?v=18908';
import { generateGeminiContent } from './geminiSettings.js?v=18908';
import { getTranslationLanguage, getTranslationName } from './translationSettings.js?v=18908';
import { sentenceUsesTargetForm, targetWordForms } from '../utils/wordForms.js?v=18908';
import { shuffleItems } from '../utils/collections.js';

export const SENTENCE_BUILDER_CACHE = 'keepvocab_ai_sentence_builder_cache_v1';

const FUNCTION_LEADERS = new Set([
  'a', 'an', 'the', 'to', 'in', 'on', 'at', 'of', 'for', 'by', 'with', 'from', 'into', 'onto', 'and', 'or', 'but'
]);

const FALLBACK_DISTRACTORS = [
  'suddenly', 'always', 'never', 'quietly', 'carefully', 'quickly', 'nearly', 'simply',
  'however', 'already', 'perhaps', 'together', 'before', 'without', 'through', 'between'
];

function cleanSentence(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTileToken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[“”"'`.,!?;:()[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSentence(sentence) {
  const cleaned = cleanSentence(sentence);
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map(part => part.replace(/^[“”"'(\[]+|[“”"')\].,!?;:]+$/g, ''))
    .filter(Boolean);
}

// Keep long example sentences fun to assemble by pairing short function words
// with their neighbor so every puzzle stays around 4–10 tactile tiles.
function compactTokens(tokens, targetForms) {
  const formSet = new Set((targetForms || []).map(normalizeTileToken).filter(Boolean));
  const result = [...tokens];
  let guard = 0;
  while (result.length > 9 && guard < 20) {
    guard += 1;
    let merged = false;
    for (let index = 0; index < result.length - 1; index += 1) {
      const left = normalizeTileToken(result[index]);
      const right = normalizeTileToken(result[index + 1]);
      if (formSet.has(left) || formSet.has(right)) continue;
      if (result[index].includes(' ') || result[index + 1].includes(' ')) continue;
      if (FUNCTION_LEADERS.has(left) && left.length <= 4 && right.length <= 8) {
        result.splice(index, 2, `${result[index]} ${result[index + 1]}`);
        merged = true;
        break;
      }
    }
    if (!merged) {
      for (let index = 0; index < result.length - 1; index += 1) {
        const left = normalizeTileToken(result[index]);
        const right = normalizeTileToken(result[index + 1]);
        if (formSet.has(left) || formSet.has(right)) continue;
        if (result[index].includes(' ') || result[index + 1].includes(' ')) continue;
        if (left.length + right.length <= 10) {
          result.splice(index, 2, `${result[index]} ${result[index + 1]}`);
          merged = true;
          break;
        }
      }
    }
    if (!merged) break;
  }
  return result;
}

export function canBuildSentenceExercise(word, sentenceOverride = null) {
  if (!word?.word) return false;
  const sentence = cleanSentence(sentenceOverride ?? exampleForLearning(word));
  if (!sentence) return false;
  const tokens = tokenizeSentence(sentence);
  if (tokens.length < 4 || tokens.length > 22) return false;
  return sentenceUsesTargetForm(sentence, word);
}

function sanitizeCustomDistractors(rawDistractors, word, targetTokens) {
  const used = new Set(targetTokens.flatMap(token => token.split(/\s+/).map(normalizeTileToken)));
  const forms = new Set(targetWordForms(word).map(normalizeTileToken).filter(Boolean));
  const clean = [];
  for (const item of Array.isArray(rawDistractors) ? rawDistractors : []) {
    const label = String(item || '').trim().replace(/^[“”"'(\[]+|[“”"')\].,!?;:]+$/g, '');
    const norm = normalizeTileToken(label);
    if (!norm || norm.length < 2 || norm.length > 20 || /\s/.test(label)) continue;
    if (used.has(norm) || forms.has(norm) || clean.some(existing => normalizeTileToken(existing) === norm)) continue;
    clean.push(label.toLowerCase());
  }
  return clean;
}

function pickDistractors(word, targetTokens, allWords = [], count = 1, preferred = []) {
  if (count <= 0) return [];
  const used = new Set(targetTokens.flatMap(token => token.split(/\s+/).map(normalizeTileToken)));
  const targetNormalized = normalizeTileToken(word.word);
  const custom = sanitizeCustomDistractors(preferred, word, targetTokens);
  const samePos = [];
  const otherPos = [];
  for (const candidate of Array.isArray(allWords) ? allWords : []) {
    const label = String(candidate?.word || '').trim();
    const norm = normalizeTileToken(label);
    if (!norm || norm === targetNormalized || used.has(norm) || label.includes(' ')) continue;
    if (word.partOfSpeech && candidate.partOfSpeech && candidate.partOfSpeech === word.partOfSpeech) {
      samePos.push(label.toLowerCase());
    } else {
      otherPos.push(label.toLowerCase());
    }
  }
  const pool = [...new Set([...custom, ...shuffleItems(samePos), ...shuffleItems(otherPos), ...shuffleItems(FALLBACK_DISTRACTORS)])]
    .filter(item => !used.has(normalizeTileToken(item)));
  return pool.slice(0, count);
}

export function buildSentencePuzzle(word, allWords = [], {
  includeDistractors = true,
  sentence: sentenceOverride = null,
  distractors: preferredDistractors = null,
  source = 'saved-example'
} = {}) {
  const sentence = cleanSentence(sentenceOverride ?? exampleForLearning(word));
  const rawTokens = tokenizeSentence(sentence);
  if (rawTokens.length < 4) return null;
  const forms = targetWordForms(word);
  const targetTokens = compactTokens(rawTokens, forms);
  const distractorCount = includeDistractors ? (targetTokens.length <= 6 ? 2 : 1) : 0;
  const distractors = pickDistractors(word, targetTokens, allWords, distractorCount, preferredDistractors);
  const unshuffled = [
    ...targetTokens.map((text, index) => ({ id: `t-${index}`, text, isDistractor: false })),
    ...distractors.map((text, index) => ({ id: `d-${index}`, text, isDistractor: true }))
  ];
  let tiles = shuffleItems(unshuffled);
  const sameOrder = tiles.slice(0, targetTokens.length).every((tile, index) => tile.text === targetTokens[index]);
  if (sameOrder && tiles.length > 1) {
    tiles = [...tiles.slice(1), tiles[0]];
  }
  return {
    sentence,
    targetTokens,
    tiles,
    distractorCount: distractors.length,
    targetWord: String(word.word || '').trim(),
    definition: definitionForLearning(word),
    source: sentenceOverride ? source : 'saved-example'
  };
}

export function evaluateSentenceAssembly(targetTokens = [], chosenTokens = []) {
  const expected = targetTokens.map(normalizeTileToken).filter(Boolean).join(' ');
  const actual = chosenTokens.map(normalizeTileToken).filter(Boolean).join(' ');
  return {
    correct: Boolean(expected) && actual === expected,
    assembledSentence: chosenTokens.join(' ').trim(),
    expectedSentence: targetTokens.join(' ').trim()
  };
}

function cacheKey(words, storage) {
  return JSON.stringify([
    getTranslationLanguage(storage),
    (words || []).map(word => [word.id, word.word, word.translation, word.definition, word.updatedAt])
  ]);
}

function readCache(storage) {
  try {
    const cache = JSON.parse(storage?.getItem(SENTENCE_BUILDER_CACHE) || '{}');
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
  } catch { return {}; }
}

function sanitizeGeneratedSentenceSet(result, words) {
  const byId = new Map((words || []).map(word => [String(word.id), word]));
  const items = (Array.isArray(result?.items) ? result.items : []).map(item => {
    const word = byId.get(String(item?.wordId || ''));
    const sentence = cleanSentence(item?.sentence);
    if (!word || !sentence) return null;
    const tokens = tokenizeSentence(sentence);
    if (tokens.length < 4 || tokens.length > 16) return null;
    if (!sentenceUsesTargetForm(sentence, word) || !isModernUsageExample(word, sentence)) return null;
    const distractors = sanitizeCustomDistractors(item?.distractors, word, tokens).slice(0, 2);
    return {
      wordId: String(word.id),
      sentence,
      distractors,
      source: item.source === 'saved-example' ? 'saved-example' : 'ai'
    };
  }).filter(Boolean);
  const uniqueItems = [...new Map(items.map(item => [item.wordId, item])).values()];
  return {
    kind: uniqueItems.some(item => item.source === 'saved-example')
      ? (uniqueItems.every(item => item.source === 'saved-example') ? 'local' : 'mixed') : 'ai',
    items: uniqueItems,
    skippedWordIds: [...byId.keys()].filter(id => !uniqueItems.some(item => item.wordId === id))
  };
}

export function buildLocalSentenceSet(words) {
  const items = (words || []).map(word => {
    const sentence = cleanSentence(exampleForLearning(word));
    return canBuildSentenceExercise(word, sentence)
      ? { wordId: String(word.id), sentence, distractors: [], source: 'saved-example' }
      : null;
  }).filter(Boolean);
  if (!items.length) {
    throw new Error('Add saved examples or connect Google AI Studio to unlock Build Sentence.');
  }
  return {
    kind: 'local',
    items,
    skippedWordIds: (words || []).map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id))
  };
}

export function buildSentenceGenerationPrompt(words, { storage = globalThis.localStorage } = {}) {
  const ukrainian = getTranslationLanguage(storage) === 'uk';
  const targets = (words || []).map(word => ({
    wordId: String(word.id),
    word: cleanSentence(word.word),
    partOfSpeech: cleanSentence(word.partOfSpeech || ''),
    selectedMeaning: cleanSentence(ukrainian && word.translationLanguage === 'uk' ? word.translation || word.definition : word.definition)
  }));
  return `Create short, natural English sentences for a Duolingo-style word-tile sentence builder. Preferred meaning-hint language: ${getTranslationName(storage)}.

Return JSON only with this shape:
{"items":[{"wordId":"exact supplied id","sentence":"natural 6-11 word sentence using the target word","distractors":["word1","word2"]}]}

Rules:
- Base every sentence strictly on the exact selected meaning supplied below.
- Write every sentence in clear, modern, everyday English (6 to 11 words).
- Write one item for every target and preserve every wordId exactly.
- Each sentence must use its target word (or a natural grammatical inflection of it) clearly once.
- Avoid awkward clauses, semicolons, quotations, or ambiguous word orders where multiple permutations are equally natural.
- For "distractors", provide 2 plausible single English words (lowercase, not already in the sentence) that fit the topic or grammar style as extra word-bank tiles without making an alternate valid sentence.
- Do not copy dictionary definitions or cram multiple targets into one sentence.

Targets: ${JSON.stringify(targets)}`;
}

export async function generateSentenceBuilderSet(words, options = {}) {
  const selected = (words || []).filter(word => word?.id && word?.word && word?.definition);
  if (!selected.length) throw new Error('Add vocabulary words to practise Build Sentence.');
  const storage = options.storage || globalThis.localStorage;
  const key = cacheKey(selected, storage);
  const cached = readCache(storage)[key];
  if (!options.force && cached) {
    try {
      const clean = sanitizeGeneratedSentenceSet(cached, selected);
      if (clean.items.length) return clean;
    } catch { /* replace invalid cache */ }
  }
  const generate = options.generate || generateGeminiContent;
  const result = await generate(buildSentenceGenerationPrompt(selected, { storage }), {
    json: true,
    maxOutputTokens: Math.max(700, selected.length * 160),
    storage
  });
  const firstPass = sanitizeGeneratedSentenceSet(result, selected);
  let items = firstPass.items;
  const missing = selected.filter(word => !items.some(item => item.wordId === String(word.id)));
  if (missing.length) {
    try {
      const retry = await generate(
        `${buildSentenceGenerationPrompt(missing, { storage })}\nThis is a repair request. Return only the ${missing.length} missing item${missing.length === 1 ? '' : 's'}, with every supplied wordId exactly.`,
        { json: true, maxOutputTokens: Math.max(500, missing.length * 160), storage }
      );
      const repaired = sanitizeGeneratedSentenceSet(retry, missing);
      items = [...items, ...repaired.items.filter(item => !items.some(existing => existing.wordId === item.wordId))];
    } catch { /* keep valid first-pass items and fall back locally below */ }
  }
  const aiItemCount = items.length;
  const localItems = selected
    .filter(word => !items.some(existing => existing.wordId === String(word.id)))
    .map(word => {
      const sentence = cleanSentence(exampleForLearning(word));
      return canBuildSentenceExercise(word, sentence)
        ? { wordId: String(word.id), sentence, distractors: [], source: 'saved-example' }
        : null;
    })
    .filter(Boolean);
  items = [...items, ...localItems];
  if (!items.length) {
    throw new Error('Gemini and saved examples could not create sentence puzzles for these words. Try again or check your Gemini key.');
  }
  const clean = {
    kind: localItems.length ? (aiItemCount ? 'mixed' : 'local') : 'ai',
    items,
    skippedWordIds: selected.map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id))
  };
  if (storage) {
    const cache = readCache(storage);
    cache[key] = clean;
    const recent = Object.fromEntries(Object.entries(cache).slice(-12));
    try { storage.setItem(SENTENCE_BUILDER_CACHE, JSON.stringify(recent)); } catch { /* cache is disposable */ }
  }
  return clean;
}
