import { driveSync } from './driveSync.js?v=18908';
import { MEANING_MODEL_TAG, MEANING_MERGE_THRESHOLD } from '../ml/meaningConfig.js';
import { CLIP_TAG } from '../ml/clipConfig.js';
import { meaningComparisonText, MEANING_COMPARISON_VERSION } from './meaningComparison.js';

const definition = s => String(s.sourceDefinition || s.definition || '').trim();
// The exact definition is always retained as a separate anchor. Cleaning is an
// additional feature, never a replacement for the meaning or its negation.
export const cleanEquivalenceText = s => meaningComparisonText(s).replace(/[,;]\s*(?:not|rather than|instead of)\s+[^,;.]+/gi, '').trim() || meaningComparisonText(s);
export const meaningPairKey = (word, pos, a, b) => JSON.stringify([String(word).toLowerCase(), String(pos).toLowerCase(), ...[a, b].sort()]);
// Lookup-only decisions. Callers own their lifetime; these are never persisted.
export function createMeaningJudgment(word, a, b, equivalent) {
  return { key: meaningPairKey(word, a.partOfSpeech, definition(a), definition(b)),
    word: String(word).toLowerCase(), partOfSpeech: a.partOfSpeech,
    definitionA: definition(a), definitionB: definition(b), label: equivalent ? 1 : 0, source: 'user' };
}
export async function embedMeaningAnchors(word, senses, options = {}) {
  const encode = options.encodeDefinitionTexts || (await import('./imageLearning.js?v=18908')).encodeDefinitionTexts;
  const texts = senses.flatMap(s => { const raw = meaningComparisonText(definition(s)); return [raw, cleanEquivalenceText(raw), `${word} (${s.partOfSpeech || 'word'}): ${raw}`]; });
  const vectors = await encode(texts, options);
  if (!vectors || vectors.length !== texts.length) return null;
  return senses.map((_, i) => ({ raw: vectors[3 * i], clean: vectors[3 * i + 1], context: vectors[3 * i + 2] }));
}
export function pairEvidence(a, b, av, bv) {
  return { encoder: CLIP_TAG, comparisonVersion: MEANING_COMPARISON_VERSION, definitionA: definition(a), definitionB: definition(b), rawA: av.raw, rawB: bv.raw,
    cleanA: av.clean, cleanB: bv.clean, contextA: av.context, contextB: bv.context };
}

const KEY = 'meaningEquivalenceLearning-v1';
const correctionSense = sense => Object.fromEntries(['id', 'word', 'partOfSpeech', 'definition', 'sourceDefinition', 'sourceDefinitions', 'rawDefinition', 'sourceUrl', 'sourceFingerprint', 'source', 'provider', 'attribution', 'license', 'dictionaryEvidence'].filter(key => sense[key] !== undefined).map(key => [key, structuredClone(sense[key])]));
export async function getMeaningCorrectionsForTraining() {
  await driveSync.imageHistory.ready;
  const saved = await driveSync.imageHistory.readState(KEY);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), purpose: 'user-meaning-corrections',
    trainingPolicy: 'Validate exact dictionary extraction receipts and disjoint splits before training; missing provenance is quarantined.',
    corrections: Array.isArray(saved?.corrections) ? saved.corrections : [] };
}
let queue = Promise.resolve();
export function recordMeaningJudgment(word, a, b, equivalent, options = {}) {
  const operation = async () => {
    if (!word || a.partOfSpeech !== b.partOfSpeech || !definition(a) || !definition(b)) throw new Error('Choose two meanings of the same word and part of speech.');
    const record = createMeaningJudgment(word, a, b, equivalent);
    const { corrections } = await getMeaningCorrectionsForTraining();
    corrections.push({
      schemaVersion: 1, id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      pairKey: record.key, occurredAt: new Date().toISOString(), word: record.word, partOfSpeech: record.partOfSpeech,
      action: options.correctionAction || (equivalent ? 'merge' : 'unmerge'), label: record.label, source: 'user',
      surface: options.surface || 'meaning-pair-review', senseA: correctionSense(a), senseB: correctionSense(b),
      model: { tag: options.modelTag || MEANING_MODEL_TAG, threshold: MEANING_MERGE_THRESHOLD,
        comparisonVersion: MEANING_COMPARISON_VERSION, score: Number.isFinite(options.modelScore) ? options.modelScore : null },
      trainingEligibility: 'pending-dictionary-provenance-validation'
    });
    // Log only: no vector generation, fitting, or saved inference overrides.
    await driveSync.imageHistory.writeState(KEY, { corrections });
    return { record, recorded: true, trained: false };
  };
  queue = queue.catch(() => {}).then(operation);
  return queue;
}
