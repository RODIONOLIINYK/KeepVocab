import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_TAG, CLIP_DIMENSION } from '../js/ml/clipConfig.js';
import { normalizedVector, cosine } from '../js/services/imagePreferences.js';
import { invariantFeatures, fitInvariantHead, validInvariantHead, cleanInvariantVector } from '../js/services/vocabInvariantHead.js';
import { equivalenceFeatures, fitEquivalenceHead, validEquivalenceHead, equivalenceProbability } from '../js/services/meaningEquivalenceHead.js';
import { targetGatedCosine } from '../js/services/imageLearning.js';
import { normalizeImageEvent } from '../js/services/imageLearningHistory.js';
import { encodeMeaning, IMAGE_PREPROCESSING } from '../js/services/imagePersonalizer.js';
import { validateLearnedHead } from '../js/services/learnedHeadValidation.js';
import { getPretrainedInvariantHead, getPretrainedEquivalenceHead } from '../js/ml/pretrainedSemanticHeads.js';

const basis = i => Array.from({ length: CLIP_DIMENSION }, (_, j) => Number(j === i));
const evidence = { encoder: CLIP_TAG, full: basis(0), crop: basis(1), meaning: basis(1), scene: basis(1), contrast: basis(0), unwanted: basis(2) };
test('frozen generic paraphrase pretraining is encoder-specific, immutable and cannot independently merge meanings', () => {
  const head = getPretrainedEquivalenceHead();
  assert.equal(validEquivalenceHead(head), true);
  assert.equal(head.threshold, null);
  assert.equal(head.pretraining.sampleCount, 6000);
  assert.equal(head.pretraining.automaticMerging, false);
  head.wProd[0] = 123;
  assert.notEqual(getPretrainedEquivalenceHead().wProd[0], 123);
  assert.equal(getPretrainedInvariantHead(), null, 'Regressing image candidate must stay inactive');
});
test('all twelve ranking features use the matching full/crop/scene/contrast views', () => {
  const features = invariantFeatures(evidence), blend = normalizedVector(basis(0).map((v, i) => .55 * v + .45 * basis(1)[i]));
  assert.equal(features.length, 12);
  assert.deepEqual(features.slice(0, 2), [0, 1]);
  assert.deepEqual(features.slice(3, 5), [0, 1]);
  assert.equal(features[6], 1); assert.equal(features[7], 1);
  assert.ok(Math.abs(features[8] - (blend[1] - blend[0])) < 1e-12);
  assert.equal(features[9], 1); assert.equal(features[11], 0);
});
test('background direction requires explicit foreground-demoted negatives and relative losers cannot become negatives', () => {
  const rows = [0, 1, 2, 3].map(i => ({ label: i % 2, rankingEvidence: evidence }));
  const plain = fitInvariantHead(rows); assert.equal(validInvariantHead(plain), true); assert.ok(plain.uBg.every(x => x === 0));
  rows[0].feedbackReason = 'background'; rows[2].feedbackReason = 'background';
  const head = fitInvariantHead(rows); assert.equal(head.foregroundCount, 2);
  assert.ok(Math.abs(cosine(head.uBg, normalizedVector(evidence.full.map((v, i) => v - evidence.crop[i]))) - 1) < 1e-12);
  assert.ok(head.fisherDiag.every(v => v >= .75 && v <= 1.35));
  const cleaned = cleanInvariantVector(evidence.full, head, .22);
  assert.ok(Math.abs(cosine(cleaned, head.uBg)) < Math.abs(cosine(evidence.full, head.uBg)));
  assert.equal(fitInvariantHead(rows.map(r => r.label ? r : { ...r, kind: 'comparison' })), null);
});
test('eleven-feature equivalence head learns both coordinate agreement and absolute difference, with symmetric scores', () => {
  const pair = same => ({ encoder: CLIP_TAG, definitionA: 'A person running quickly.', definitionB: same ? 'A person running fast.' : 'A person standing still.',
    rawA: basis(0), rawB: basis(same ? 0 : 1), cleanA: basis(0), cleanB: basis(same ? 0 : 1), contextA: basis(0), contextB: basis(same ? 0 : 1) });
  const rows = [true, true, false, false].map(same => ({ label: Number(same), evidence: pair(same) }));
  const head = fitEquivalenceHead(rows); assert.equal(validEquivalenceHead(head), true);
  assert.equal(head.wProd.length, CLIP_DIMENSION); assert.equal(head.wDiff.length, CLIP_DIMENSION);
  assert.equal(equivalenceFeatures(pair(true), head).length, 11);
  assert.ok(equivalenceProbability(head, pair(true)) > equivalenceProbability(head, pair(false)));
  const e = pair(false), swapped = { ...e, definitionA: e.definitionB, definitionB: e.definitionA, rawA: e.rawB, rawB: e.rawA, cleanA: e.cleanB, cleanB: e.cleanA, contextA: e.contextB, contextB: e.contextA };
  assert.equal(equivalenceProbability(head, e), equivalenceProbability(head, swapped));
  assert.equal(validEquivalenceHead({ ...head, encoder: 'retired' }), false);
});
test('feedback retains exact multi-view evidence and foreground reason through normalization', () => {
  const row = normalizeImageEvent({ id: 'pixels', encoder: CLIP_TAG, label: 0, updatedAt: '2026-11-03T20:00:00Z',
    features: encodeMeaning(basis(0)), meaningFeatures: encodeMeaning(basis(1)), preprocessing: IMAGE_PREPROCESSING, rankingEvidence: evidence, feedbackReason: 'background' });
  assert.deepEqual(row.rankingEvidence, evidence); assert.equal(row.feedbackReason, 'background');
  assert.equal(normalizeImageEvent({ ...row, label: 1 }).feedbackReason, undefined);
});
test('target-weighted cosine stays bounded and preserves agreement on negative coordinates', () => {
  const v = normalizedVector(Array.from({ length: CLIP_DIMENSION }, (_, i) => Math.sin(i * 1.3) - .3));
  assert.ok(Math.abs(targetGatedCosine(v, v) - 1) < 1e-12);
  assert.ok(Math.abs(targetGatedCosine(v, v.map(x => -x)) + 1) < 1e-12);
  const other = normalizedVector(v.map((x, i) => x + .02 * Math.cos(i)));
  assert.ok(Math.abs(targetGatedCosine(other, v)) <= 1);
});
test('a lower classification loss cannot promote worse first-choice ranking on held-out words', () => {
  const rows = Array.from({ length: 40 }, (_, i) => [0, 1].map(label => ({ word: `word-${i}`, label }))).flat();
  let training;
  const result = validateLearnedHead(rows, { group: r => r.word, rankingGroup: r => r.word,
    fit: input => { training = input; return {}; }, baseline: r => r.label ? .99 : .98,
    score: (_head, r) => r.label ? .4 : .45 });
  assert.equal(result.accepted, false); assert.match(result.reason, /first-choice/);
  assert.ok(result.after < result.before); assert.equal(result.afterTop1, 0); assert.ok(result.beforeTop1 >= 2);
  const trainWords = new Set(training.map(r => r.word));
  assert.ok(rows.some(r => !trainWords.has(r.word)));
});
