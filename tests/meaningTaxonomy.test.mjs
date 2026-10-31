import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyReviewedDecisions, assertReviewedContent, assignMeaningPartitions,
  auditMeaningTaxonomy, reviewContentHash } from '../scripts/lib/meaning-taxonomy.mjs';

const base = new URL('./fixtures/meaning-taxonomy/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const dataset = await read('dataset.json'), review = await read('review.json');
const decisions = await read('review-decisions.json');
const legacy = await read('source/legacy-annotations.json'), authored = await read('source/authored-annotations.json');
const cases = JSON.parse(await readFile(new URL('./fixtures/image-pretraining-v2/cases.json', import.meta.url), 'utf8'));

test('reviewed taxonomy covers legacy meanings and has every class in each learning split', () => {
  const result = auditMeaningTaxonomy(dataset, review, cases);
  assert.equal(result.count, 417);
  assert(result.multilabelRows > 0);
  assert.equal(result.counts.quarantine, 5);
  assertReviewedContent(applyReviewedDecisions(legacy.items, authored.examples, decisions), decisions);
});

test('an annotation edit invalidates its existing review', () => {
  const edited = structuredClone(dataset);
  const row = edited.items.find(item => item.word === 'blood');
  row.requiredEvidence = 'A red object alone.';
  assert.throws(() => auditMeaningTaxonomy(edited, review, cases), /Stale annotation review/);
});

test('a stale stored support summary cannot pass the audit', () => {
  const edited = structuredClone(review);
  edited.audit.positives.test.place++;
  assert.throws(() => auditMeaningTaxonomy(dataset, edited, cases), /Stored audit summary is stale/);
});

test('new or changed draft labels cannot inherit a previous content review', () => {
  const rows = applyReviewedDecisions(legacy.items, authored.examples, decisions);
  rows[0].labels = ['abstract'];
  assert.throws(() => assertReviewedContent(rows, decisions), /content changed/);
  assert.throws(() => assertReviewedContent([...rows, rows[0]], decisions), /row count changed/);
  assert.throws(() => applyReviewedDecisions([{ ...legacy.items[0], labels: ['unknown'] }], [], { overrides: [] }), /Unknown/);
});

test('connected families and polysemous headwords cannot cross train and test', () => {
  const rows = [
    { word: 'fly', partOfSpeech: 'verb', definition: 'Move using wings.', familyId: 'bird', originalSplit: 'train' },
    { word: 'bird', partOfSpeech: 'noun', definition: 'A feathered animal.', familyId: 'bird', originalSplit: 'train' },
    { word: 'fly', partOfSpeech: 'verb', definition: 'Travel in an aircraft.', familyId: 'airplane', originalSplit: 'test' },
    { word: 'airplane', partOfSpeech: 'noun', definition: 'A winged aircraft.', familyId: 'airplane', originalSplit: 'test' },
    { word: 'new sense', partOfSpeech: 'noun', definition: 'A fresh example.', familyId: 'unseen' }
  ];
  const assigned = assignMeaningPartitions(rows);
  assert(assigned.slice(0, 4).every(row => row.split === 'quarantine'));
  assert.equal(new Set(assigned.slice(0, 4).map(row => row.groupId)).size, 1);
  assert.equal(assigned[0].originalSplit, 'train');
  assert.equal(assigned[2].originalSplit, 'test');
  assert(['train', 'validation', 'test'].includes(assigned[4].split));
  assert.deepEqual(assignMeaningPartitions(rows), assigned);
});

test('label stress cases follow exact senses rather than POS shortcuts', () => {
  const select = (word, sourceKind = 'legacy') => dataset.items.find(row => row.word === word && row.sourceKind === sourceKind);
  assert.equal(select('rain').primaryClass, 'action');
  assert.deepEqual(select('stand').labels, ['state']);
  assert.deepEqual(select('hold').labels, ['relation']);
  assert.deepEqual(select('blood', 'authored').labels, ['entity']);
  assert.deepEqual(select('know', 'authored').labels, ['abstract']);
  const pets = dataset.items.filter(row => row.word === 'pet');
  assert.equal(pets.length, 2);
  assert.equal(new Set(pets.map(row => row.groupId)).size, 1);
  assert(pets.some(row => row.labels.includes('action')));
  assert(pets.some(row => row.labels.includes('entity')));
  assert.equal(reviewContentHash(applyReviewedDecisions(legacy.items, authored.examples, decisions)), dataset.reviewedContentSha256);
});
