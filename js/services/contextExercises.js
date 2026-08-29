import { generateGeminiContent } from './geminiSettings.js?v=93';

export const CONTEXT_EXERCISE_CACHE = 'keepvocab_ai_context_cache_v1';

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function containsTarget(sentence, target) {
  const escaped = normalize(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(normalize(sentence));
}

function cacheKey(words) {
  return (words || []).map(word => `${word.id}|${word.word}|${word.definition}|${word.updatedAt || ''}`).join('||');
}

function readCache(storage) {
  try { return JSON.parse(storage?.getItem(CONTEXT_EXERCISE_CACHE) || '{}') || {}; } catch { return {}; }
}

function sanitizeGeneratedSet(result, words, { requireComplete = true } = {}) {
  const byId = new Map((words || []).map(word => [String(word.id), word]));
  const items = (Array.isArray(result?.items) ? result.items : []).map(item => {
    const word = byId.get(String(item?.wordId || ''));
    const sentence = normalize(item?.sentence);
    if (!word || !sentence || !containsTarget(sentence, word.word)) return null;
    return { wordId: String(word.id), sentence };
  }).filter(Boolean);
  const uniqueItems = [...new Map(items.map(item => [item.wordId, item])).values()];
  if (requireComplete && uniqueItems.length !== byId.size) throw new Error('Gemini did not create a complete context set. Please try again.');
  return {
    kind: 'ai',
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

export function buildContextExercisePrompt(words) {
  const targets = (words || []).map(word => ({
    wordId: String(word.id),
    word: normalize(word.word),
    selectedMeaning: normalize(word.definition)
  }));
  return `Create English context-cloze questions for an upper-intermediate learner.

Return JSON only with this shape:
{"items":[{"wordId":"exact supplied id","sentence":"one natural sentence containing the exact target word"}]}

Rules:
- Base every sentence on the exact selected meaning supplied below.
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
  const key = cacheKey(selected);
  const cached = readCache(storage)[key];
  if (!options.force && cached) {
    try { return sanitizeGeneratedSet(cached, selected); } catch { /* replace invalid cache */ }
  }
  const generate = options.generate || generateGeminiContent;
  const result = await generate(buildContextExercisePrompt(selected), { json: true, maxOutputTokens: 1200, storage });
  const firstPass = sanitizeGeneratedSet(result, selected, { requireComplete: false });
  let items = firstPass.items;
  const missing = selected.filter(word => !items.some(item => item.wordId === String(word.id)));
  if (missing.length) {
    try {
      const retry = await generate(`${buildContextExercisePrompt(missing)}\nThis is a repair request. Return only the ${missing.length} missing item${missing.length === 1 ? '' : 's'}, with every supplied wordId exactly.`, { json: true, maxOutputTokens: Math.max(500, missing.length * 150), storage });
      const repaired = sanitizeGeneratedSet(retry, missing, { requireComplete: false });
      items = [...items, ...repaired.items.filter(item => !items.some(existing => existing.wordId === item.wordId))];
    } catch { /* keep valid first-pass items and use local examples below */ }
  }
  const localItems = localContextItems(selected).filter(item => !items.some(existing => existing.wordId === item.wordId));
  items = [...items, ...localItems];
  if (items.length < 3) throw new Error('Gemini and the saved examples did not provide enough valid context sentences. Try again or add examples to these words.');
  const clean = {
    kind: localItems.length ? (firstPass.items.length ? 'mixed' : 'local') : 'ai',
    items,
    skippedWordIds: selected.map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id))
  };
  if (storage) {
    const cache = readCache(storage);
    cache[key] = clean;
    const recent = Object.fromEntries(Object.entries(cache).slice(-12));
    storage.setItem(CONTEXT_EXERCISE_CACHE, JSON.stringify(recent));
  }
  return clean;
}

export function buildLocalContextSet(words) {
  const items = localContextItems(words);
  if (items.length < 3) throw new Error('Add saved examples to at least 3 words to practise Context without Gemini.');
  return { kind: 'local', items, skippedWordIds: (words || []).map(word => String(word.id)).filter(id => !items.some(item => item.wordId === id)) };
}

export function clozeContextSentence(sentence, word) {
  const escaped = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return normalize(sentence).replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '_____');
}
