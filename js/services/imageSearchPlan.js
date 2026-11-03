// Shared, pure retrieval planning. The research collector uses the same fallback
// queries as the app, without importing its ranking, filters or private settings.
const exact = value => String(value || '').replace(/\s+/g, ' ').trim();
export const normalizeImageQuery = value => exact(value).toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
export function fallbackImageSearchPlan(word, perQuery = 15) {
  const count = Math.min(40, Math.max(1, Math.floor(Number(perQuery) || 15)));
  return [{ kind: 'word', prompt: exact(word?.word) },
    { kind: 'meaning', prompt: exact(word?.sourceDefinition || word?.definition) }]
    .filter(item => item.prompt).map(item => ({ ...item, query: normalizeImageQuery(item.prompt), candidateBudget: count }));
}
export function hasGeminiSceneDescription(record) {
  return record?.source === 'gemini' && Array.isArray(record.scenes) && record.scenes.some(scene => exact(scene));
}
