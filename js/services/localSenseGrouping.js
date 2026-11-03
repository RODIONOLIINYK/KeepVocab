import { groupSimilarSenses, originalSenses, senseGroupingEvidence } from './learningDefinitions.js?v=18900';
import { cosine } from './imagePreferences.js';
import { CLIP_TAG } from '../ml/clipConfig.js';
import { readObjectCache, writeRecentObjectCache } from '../utils/storageCache.js?v=18900';

const CACHE_KEY = 'keepvocab_sense_groups_v1';
const VERSION = 1;

export async function groupEntrySensesLocally(entry, options = {}) {
  if (options.groupSenses === false || !Array.isArray(entry?.senses)) return entry;
  const senses = entry.senses.flatMap(originalSenses).map(sense => ({ ...sense, word: sense.word || entry.word }));
  const fallback = () => groupSimilarSenses(senses, { word: entry.word });
  if (senses.length < 2) return { ...entry, senses: fallback(), ...fallback()[0] };
  const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
  const key = JSON.stringify([VERSION, CLIP_TAG, entry.word, senses.map(({ partOfSpeech, sourceDefinition, definition, labels, tags, usageNote, antonyms }) =>
    [partOfSpeech, sourceDefinition || definition, labels, tags, usageNote, antonyms])]);
  const cache = readObjectCache(storage, CACHE_KEY);
  let pairs = cache[key]?.data;
  if (!Array.isArray(pairs) || pairs.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(i => !Number.isInteger(i) || i < 0 || i >= senses.length))) pairs = null;
  try {
    if (!pairs) {
      const candidates = [];
      for (let a = 0; a < senses.length; a++) for (let b = a + 1; b < senses.length; b++) {
        const evidence = senseGroupingEvidence(senses[a], senses[b]);
        // Deliberately conservative until reviewed pairs establish a threshold.
        if (evidence && evidence.coverage >= 0.7 && evidence.jaccard >= 0.6) candidates.push([a, b]);
      }
      if (!candidates.length) return { ...entry, senses: fallback(), ...fallback()[0] };
      const encode = options.encodeDefinitionTexts || (await import('./imageLearning.js?v=18900')).encodeDefinitionTexts;
      const vectors = await encode(senses.map(sense => String(sense.sourceDefinition || sense.definition)), options);
      options.signal?.throwIfAborted();
      if (!vectors || vectors.length !== senses.length || vectors.some(v => !Array.isArray(v) || v.length !== 512 || v.some(n => !Number.isFinite(n)))) {
        return { ...entry, senses: fallback(), ...fallback()[0] };
      }
      pairs = candidates.filter(([a, b]) => cosine(vectors[a], vectors[b]) >= 0.94);
      cache[key] = { cachedAt: Date.now(), data: pairs };
      writeRecentObjectCache(storage, CACHE_KEY, cache, 150);
    }
    const indexes = new Map(senses.map((sense, index) => [sense, index]));
    const pairSet = new Set(pairs.map(([a, b]) => `${a}:${b}`));
    const matches = (left, right) => {
      // groupSimilarSenses makes shallow copies, so resolve by exact source identity.
      const index = item => indexes.get(item) ?? senses.findIndex(s => s.id === item.id && s.partOfSpeech === item.partOfSpeech
        && (s.sourceDefinition || s.definition) === (item.sourceDefinition || item.definition));
      const a = index(left), b = index(right);
      const evidence = senseGroupingEvidence(left, right);
      return Boolean(evidence && (evidence.coverage >= 0.88 && evidence.jaccard >= 0.78
        || pairSet.has(`${Math.min(a, b)}:${Math.max(a, b)}`)));
    };
    const grouped = groupSimilarSenses(senses, { word: entry.word, matches });
    return { ...entry, senses: grouped, ...grouped[0] };
  } catch (error) {
    options.signal?.throwIfAborted();
    const grouped = fallback();
    return { ...entry, senses: grouped, ...grouped[0] };
  }
}
