import { CLIP_TAG } from '../ml/clipConfig.js';
import { driveSync } from './driveSync.js?v=18908';
import { fitEquivalenceHead, equivalenceProbability, validEquivalenceHead } from './meaningEquivalenceHead.js';
import { validateLearnedHead } from './learnedHeadValidation.js';
import { logistic } from './learnedScorer.js';
import { getPretrainedEquivalenceHead } from '../ml/pretrainedSemanticHeads.js';
import { meaningComparisonText, MEANING_COMPARISON_VERSION } from './meaningComparison.js';

const KEY = 'meaningEquivalenceLearning-v1';
const definition = s => String(s.sourceDefinition || s.definition || '').trim();
// The exact definition is always retained as a separate anchor. Cleaning is an
// additional feature, never a replacement for the meaning or its negation.
export const cleanEquivalenceText = s => meaningComparisonText(s).replace(/[,;]\s*(?:not|rather than|instead of)\s+[^,;.]+/gi, '').trim() || meaningComparisonText(s);
export const meaningPairKey = (word, pos, a, b) => JSON.stringify([String(word).toLowerCase(), String(pos).toLowerCase(), ...[a, b].sort()]);
export async function meaningLearningState() {
  await driveSync.imageHistory.ready;
  const saved = await driveSync.imageHistory.readState(KEY).catch(() => null);
  return { records: Array.isArray(saved?.records) ? saved.records : [], head: validEquivalenceHead(saved?.head) && saved.head.comparisonVersion === MEANING_COMPARISON_VERSION ? saved.head : getPretrainedEquivalenceHead(), revision: saved?.revision || 0 };
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
let queue = Promise.resolve();
export function recordMeaningJudgment(word, a, b, equivalent, options = {}) {
  const operation = async () => {
    if (!word || a.partOfSpeech !== b.partOfSpeech || !definition(a) || !definition(b)) throw new Error('Choose two meanings of the same word and part of speech.');
    const state = await meaningLearningState(), key = meaningPairKey(word, a.partOfSpeech, definition(a), definition(b));
    const vectors = await embedMeaningAnchors(word, [a, b], options);
    const record = { key, word: String(word).toLowerCase(), partOfSpeech: a.partOfSpeech, definitionA: definition(a), definitionB: definition(b),
      label: equivalent ? 1 : 0, source: 'user', encoder: CLIP_TAG, updatedAt: new Date().toISOString(),
      ...(vectors ? { evidence: pairEvidence(a, b, vectors[0], vectors[1]) } : {}) };
    const records = [...state.records.filter(r => r.key !== key), record];
    const eligible = records.filter(r => r.evidence?.encoder === CLIP_TAG && r.evidence.comparisonVersion === MEANING_COMPARISON_VERSION);
    const frozenSeed = getPretrainedEquivalenceHead();
    const result = validateLearnedHead(eligible, { group: r => r.word, fit: rows => fitEquivalenceHead(rows, frozenSeed),
      score: (head, row) => equivalenceProbability(head, row.evidence), baseline: row => state.head
        ? equivalenceProbability(state.head, row.evidence)
        : logistic(12 * ((row.evidence.rawA.reduce((s, v, i) => s + v * row.evidence.rawB[i], 0)) - .86)) });
    let promoted = state.head;
    if (result.accepted) {
      const held = eligible.filter(row => !result.trainingGroups.includes(row.word));
      const negative = held.filter(row => row.label === 0), positive = held.filter(row => row.label === 1);
      const threshold = Math.max(.9, ...negative.map(row => equivalenceProbability(result.head, row.evidence))) + 1e-6;
      const supported = threshold < 1 && negative.length >= 20 && positive.filter(row => equivalenceProbability(result.head, row.evidence) >= threshold).length >= 5;
      promoted = { ...result.head, comparisonVersion: MEANING_COMPARISON_VERSION, threshold: supported ? threshold : null,
        calibration: { heldOutPositive: positive.length, heldOutNegative: negative.length, automaticMerging: supported,
          policy: 'zero-observed-false-merges-with-minimum-support' } };
    }
    await driveSync.imageHistory.writeState(KEY, { records, head: promoted, revision: state.revision + 1 });
    return { recorded: true, trained: result.accepted, reason: result.reason || 'Meaning judgment saved.' };
  };
  queue = queue.catch(() => {}).then(operation); return queue;
}
