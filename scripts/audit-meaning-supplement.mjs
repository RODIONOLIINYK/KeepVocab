// Check the reviewed training extension without rewriting the frozen benchmark.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MEANING_CATEGORIES, sha256, normalizeHeadword } from './lib/meaning-taxonomy.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const load = async file => readFile(resolve(root, file));
const baseBytes = await load('tests/fixtures/meaning-taxonomy/dataset.json');
const supplementBytes = await load('tests/fixtures/meaning-taxonomy/supplement/dataset.json');
const base = JSON.parse(baseBytes), supplement = JSON.parse(supplementBytes);
const review = JSON.parse(await load('tests/fixtures/meaning-taxonomy/supplement/review.json'));
assert.equal(supplement.sourceDatasetSha256, sha256(baseBytes));
assert.equal(review.datasetFileSha256, sha256(supplementBytes));
assert.equal(review.reviewType, 'AI semantic review; not human-expert ground truth');
assert.equal(review.reviewedCount, supplement.items.length);
assert.deepEqual(supplement.categories, MEANING_CATEGORIES);
const oldWords = new Set(base.items.map(row => normalizeHeadword(row.word)));
const oldFamilies = new Set(base.items.map(row => normalizeHeadword(row.familyId)));
const oldDefinitions = new Set(base.items.map(row => normalizeHeadword(row.definition)));
const ids = new Set(base.items.map(row => row.id)), words = new Set();
for (const row of supplement.items) {
  assert(!ids.has(row.id)); ids.add(row.id);
  assert(!words.has(normalizeHeadword(row.word))); words.add(normalizeHeadword(row.word));
  assert(!oldWords.has(normalizeHeadword(row.word)), `Existing headword: ${row.word}`);
  assert(!oldFamilies.has(normalizeHeadword(row.familyId)), `Existing family: ${row.familyId}`);
  assert(!oldDefinitions.has(normalizeHeadword(row.definition)), `Existing definition: ${row.word}`);
  assert.equal(row.split, 'train');
  assert(row.definition.trim() && row.partOfSpeech.trim() && row.rationale.trim() && row.groupId.trim());
  assert(row.labels.length > 0 && row.labels.includes(row.primaryClass));
  assert.deepEqual(row.labels, MEANING_CATEGORIES.filter(c => row.labels.includes(c)));
  assert.deepEqual(row.targets, MEANING_CATEGORIES.map(c => Number(row.labels.includes(c))));
  assert.equal(row.review.status, 'reviewed');
  assert.equal(row.review.type, review.reviewType);
  const decision = review.decisions.find(item => item.id === row.id);
  assert(decision && decision.reason.trim());
  assert.deepEqual(decision.finalLabels, row.labels);
}
console.log(JSON.stringify({ reviewedTrainingExtension: supplement.items.length, baseDatasetUnchanged: true,
  labelsAreHumanExpertTruth: false, datasetFileSha256: sha256(supplementBytes) }));
