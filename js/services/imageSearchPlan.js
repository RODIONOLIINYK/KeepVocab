// Shared, pure retrieval planning. The research collector uses the same fallback
// queries as the app, without importing its ranking, filters or private settings.
const exact = value => String(value || '').replace(/\s+/g, ' ').trim();
// Keep retrieval and local vision work small; the review can fetch another page.
export const IMAGE_CANDIDATES_PER_SCENE = 3;
export const IMAGE_REVIEW_BATCH_SIZE = 9;
export const MAX_IMAGE_CANDIDATES = 9;
export const INITIAL_IMAGE_CANDIDATES = 3;
const IMAGE_BUDGET_KEY = 'keepvocab_image_candidate_budget';
export function imageCandidateBudget(options = {}) {
  let saved;
  try { saved = (options.storage === undefined ? globalThis.localStorage : options.storage)?.getItem(IMAGE_BUDGET_KEY); } catch {}
  const value = Number(options.imageCandidateBudget ?? saved);
  return [3, 6, 9].includes(value) ? value : 3;
}
export function saveImageCandidateBudget(value, storage = globalThis.localStorage) {
  if (![3, 6, 9].includes(Number(value))) throw new Error('Choose 3, 6, or 9 images.');
  storage?.setItem(IMAGE_BUDGET_KEY, String(value));
}
export const imageSceneCount = options => imageCandidateBudget(options) / IMAGE_CANDIDATES_PER_SCENE;

// Integer shares keep the combined vision budget at nine. Rotate remainder
// slots on subsequent pages, including which prompts run when there are >9.
export function imageCandidateBudgets(promptCount, page = 1, limit = MAX_IMAGE_CANDIDATES, perPrompt = IMAGE_CANDIDATES_PER_SCENE) {
  const count = Number.isFinite(Number(promptCount)) ? Math.max(0, Math.floor(Number(promptCount))) : 0;
  if (!count) return [];
  const total = Math.min(MAX_IMAGE_CANDIDATES, Math.max(1, Math.floor(Number(limit) || MAX_IMAGE_CANDIDATES)), count * perPrompt);
  const base = Math.floor(total / count);
  const budgets = Array(count).fill(base);
  const start = (Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page) || 1)) - 1 : 0) % count;
  for (let i = 0; i < total - base * count; i++) budgets[(start + i) % count]++;
  return budgets;
}

// Also bound direct scorer callers, before any thumbnail download or inference.
export function imageEvaluationCandidates(candidates, page = 1, limit = MAX_IMAGE_CANDIDATES, perPrompt = IMAGE_CANDIDATES_PER_SCENE) {
  const cap = Math.min(MAX_IMAGE_CANDIDATES, Math.max(1, Math.floor(Number(limit) || MAX_IMAGE_CANDIDATES)));

  const seen = new Set();
  const unique = candidates.filter(image => {
    if (!image?.url || seen.has(image.url)) return false;
    seen.add(image.url); return true;
  });
  const groups = new Map();
  for (const image of unique) {
    const prompt = image.visualScene || image.searchQuery || '';
    if (!groups.has(prompt)) groups.set(prompt, []);
    groups.get(prompt).push(image);
  }
  // Retrieval has already allocated these slots; do not reallocate after a
  // prompt yielded fewer unique results (or reorder an already ranked pool).
  if (unique.length <= cap && [...groups.values()].every(group => group.length <= perPrompt)) return unique;
  if (groups.size === 1 && groups.has('')) return unique.slice(0, cap);
  const buckets = [...groups.values()];
  const budgets = imageCandidateBudgets(buckets.length, page, cap, perPrompt);
  const selected = [];
  for (let row = 0; row < perPrompt; row++) {
    buckets.forEach((bucket, index) => { if (row < budgets[index] && bucket[row]) selected.push(bucket[row]); });
  }
  return selected;
}
export const normalizeImageQuery = value => exact(value).toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function fallbackImageSearchPlan(word, perQuery = IMAGE_CANDIDATES_PER_SCENE) {
  const count = Math.min(40, Math.max(1, Math.floor(Number(perQuery) || IMAGE_CANDIDATES_PER_SCENE)));
  return [{ kind: 'word', prompt: exact(word?.word) },
    { kind: 'meaning', prompt: exact(word?.sourceDefinition || word?.definition) }]
    .filter(item => item.prompt).map(item => ({ ...item, query: normalizeImageQuery(item.prompt), candidateBudget: count }));
}
export function hasGeminiSceneDescription(record) {
  return record?.source === 'gemini' && Array.isArray(record.scenes) && record.scenes.some(scene => exact(scene));
}
