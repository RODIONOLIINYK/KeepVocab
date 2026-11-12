import { sourceDefinitionFingerprint } from './learningDefinitions.js?v=18908';

// Aliases identify immutable observations, not replacement event IDs. Bind them
// to the surviving meaning so editing its meaning cannot reuse old evidence.
export function reviewHistoryIdentity(word) {
  return JSON.stringify([word?.courseId || 'english', word?.monthYear || '', String(word?.id || ''), sourceDefinitionFingerprint(word)]);
}

export function normalizeReviewHistorySources(sources) {
  const entries = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (typeof source?.wordId !== 'string' || !source.wordId || source.wordId.length > 500
      || typeof source.senseId !== 'string' || !/^source-v1-[a-f0-9]{16}$/.test(source.senseId)) continue;
    const clean = { wordId: source.wordId, senseId: source.senseId };
    entries.set(JSON.stringify(clean), clean);
  }
  return [...entries.values()].sort((a, b) => a.wordId.localeCompare(b.wordId) || a.senseId.localeCompare(b.senseId));
}

export function reviewHistorySources(word) {
  const own = { wordId: String(word?.id || ''), senseId: sourceDefinitionFingerprint(word) };
  const aliases = word?.reviewHistoryIdentity === reviewHistoryIdentity(word) && Array.isArray(word?.reviewHistoryAliases)
    ? word.reviewHistoryAliases : [];
  return normalizeReviewHistorySources([own, ...aliases]);
}

export function withReviewHistorySources(word, sources) {
  const { reviewHistoryIdentity: previousIdentity, reviewHistoryAliases: previousAliases, ...record } = word;
  const ownFingerprint = sourceDefinitionFingerprint(word);
  const aliases = normalizeReviewHistorySources(sources).filter(source => source.wordId !== String(word.id) || source.senseId !== ownFingerprint);
  return aliases.length ? { ...record, reviewHistoryIdentity: reviewHistoryIdentity(word), reviewHistoryAliases: aliases } : record;
}

export function indexReviewEvents(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.wordId)) grouped.set(event.wordId, []);
    grouped.get(event.wordId).push(event);
  }
  return grouped;
}

export function reviewEventsForWord(word, grouped) {
  return [...new Set(reviewHistorySources(word).map(source => source.wordId))].flatMap(id => grouped.get(id) || []);
}
