import { generateGeminiContent } from './geminiSettings.js?v=18200';
import { getTranslationLanguage, getTranslationName } from './translationSettings.js?v=18200';

export const CONTEXT_EXERCISE_CACHE = 'keepvocab_ai_context_cache_v3';

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function lexicalTarget(value) {
  return normalize(value).replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

function targetPattern(target, flags = 'iu') {
  const escaped = lexicalTarget(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped ? new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, flags) : null;
}

function containsTarget(sentence, target) {
  const pattern = targetPattern(target);
  return pattern ? pattern.test(normalize(sentence)) : false;
}

function cacheKey(words, storage) {
  return JSON.stringify([getTranslationLanguage(storage), (words || []).map(word => [word.id, word.word, word.translation, word.definition, word.example, word.updatedAt])]);
}

function readCache(storage) {
  try {
    const cache = JSON.parse(storage?.getItem(CONTEXT_EXERCISE_CACHE) || '{}');
    return cache && typeof cache === 'object' && !Array.isArray(cache) ? cache : {};
  } catch { return {}; }
}

function sanitizeGeneratedSet(result, words) {
  const byId = new Map((words || []).map(word => [String(word.id), word]));
  const items = (Array.isArray(result?.items) ? result.items : []).map(item => {
    const word = byId.get(String(item?.wordId || ''));
    const sentence = normalize(item?.sentence);
    if (!word || !sentence || !containsTarget(sentence, word.word)) return null;
    return { wordId: String(word.id), sentence, ...(item.source === 'saved-example' ? { source: item.source } : {}) };
  }).filter(Boolean);
  const uniqueItems = [...new Map(items.map(item => [item.wordId, item])).values()];
  return {
    kind: uniqueItems.some(item => item.source === 'saved-example')
      ? (uniqueItems.every(item => item.source === 'saved-example') ? 'local' : 'mixed') : 'ai',
    items: uniqueItems,
    skippedWordIds: [...byId.keys()].filter(id => !uniqueItems.some(item => item.wordId === id))
  };
}

function localContextItems(words) {
  return (words || []).map(word => {
    const sentence = normalize(word.example);
    return sentence && containsTarget(sentence, word.word) ? { wordId: String(word.id), sentence, source: 'saved-example' } : null;
  }).filter(Boolean);
}

export function buildContextExercisePrompt(words, { storage = globalThis.localStorage } = {}) {
  const ukrainian = getTranslationLanguage(storage) === 'uk';
  const targets = (words || []).map(word => ({
    wordId: String(word.id),
    word: normalize(word.word),
    selectedMeaning: normalize(ukrainian && word.translationLanguage === 'uk' ? word.translation || word.definition : word.definition)
  }));
  return `Create English context-cloze questions for an upper-intermediate English learner. Preferred meaning-hint language: ${getTranslationName(storage)}.

Return JSON only with this shape:
{"items":[{"wordId":"exact supplied id","sentence":"one natural sentence containing the exact target word"}]}

Rules:
- Base every sentence on the exact selected meaning supplied below.
- Write the entire sentence in natural English. Selected meanings may be written in ${getTranslationName(storage)}; understand that meaning and produce an English sentence.
- Write one item for every target and preserve every wordId exactly.
- Each item sentence must contain its target spelling exactly once.
- The sentence must make the intended meaning inferable from the situation, without stating a dictionary definition or explicit synonym clue.
- Every item stands alone. Do not create a story, passage, dialogue, introduction, title, or shared scene.
- Keep each sentence plausible and natural. Do not cram multiple targets into one sentence.
- Do not use or infer any dictionary example sentence. Only the selected meanings below are source material.

Targets: ${JSON.stringify(targets)}`;
}

export async function generateContextExerciseSet(words, options = {}) {
  const selected = (words || []).filter(word => word?.id && word?.word && word?.definition);
  if (selected.length < 3) throw new Error('Add at least 3 vocabulary meanings for Context.');
  const storage = options.storage || globalThis.localStorage;
  const key = cacheKey(selected, storage);
  const cached = readCache(storage)[key];
  if (!options.force && cached) {
    try {
      const clean = sanitizeGeneratedSet(cached, selected);
      if (clean.items.length >= 3) return clean;
    } catch { /* replace invalid cache */ }
  }
  const generate = options.generate || generateGeminiContent;
  const result = await generate(buildContextExercisePrompt(selected, { storage }), { json: true, maxOutputTokens: 1200, storage });
  const firstPass = sanitizeGeneratedSet(result, selected);
  let items = firstPass.items;
  const missing = selected.filter(word => !items.some(item => item.wordId === String(word.id)));
  if (missing.length) {
    try {
      const retry = await generate(`${buildContextExercisePrompt(missing, { storage })}\nThis is a repair request. Return only the ${missing.length} missing item${missing.length === 1 ? '' : 's'}, with every supplied wordId exactly.`, { json: true, maxOutputTokens: Math.max(500, missing.length * 150), storage });
      const repaired = sanitizeGeneratedSet(retry, missing);
      items = [...items, ...repaired.items.filter(item => !items.some(existing => existing.wordId === item.wordId))];
    } catch { /* keep valid first-pass items and use local examples below */ }
  }
  const aiItemCount = items.length;
  const localItems = localContextItems(selected).filter(item => !items.some(existing => existing.wordId === item.wordId));
  items = [...items, ...localItems];
  if (items.length < 3) throw new Error('Gemini and the saved examples did not provide enough valid context sentences. Try again or add examples to these words.');
  const clean = {
    kind: localItems.length ? (aiItemCount ? 'mixed' : 'local') : 'ai',
    items,
    skippedWordIds: selected.map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id))
  };
  if (storage) {
    const cache = readCache(storage);
    cache[key] = clean;
    const recent = Object.fromEntries(Object.entries(cache).slice(-12));
    try { storage.setItem(CONTEXT_EXERCISE_CACHE, JSON.stringify(recent)); } catch { /* cache is disposable */ }
  }
  return clean;
}

export function buildLocalContextSet(words) {
  const items = localContextItems(words);
  if (items.length < 3) throw new Error('Add saved examples to at least 3 words to practise Context without Gemini.');
  return { kind: 'local', items, skippedWordIds: (words || []).map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id)) };
}

export function clozeContextSentence(sentence, word) {
  const pattern = targetPattern(word, 'giu');
  if (!pattern) return normalize(sentence);
  return normalize(sentence).replace(pattern, (_match, prefix) => `${prefix}_____`);
}
