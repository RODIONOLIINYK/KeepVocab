import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyReviewedDecisions, assertReviewedContent, auditMeaningTaxonomy, sha256 } from './lib/meaning-taxonomy.mjs';

const base = new URL('../tests/fixtures/meaning-taxonomy/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const dataset = await read('dataset.json'), review = await read('review.json');
const decisions = await read('review-decisions.json');
for (const field of ['reviewType', 'reviewer', 'reviewScope', 'policyDecisions', 'reviewedContentSha256']) {
  assert.deepEqual(review[field], decisions[field], `Review summary changed: ${field}.`);
}
const legacy = await read('source/legacy-annotations.json'), authored = await read('source/authored-annotations.json');
assertReviewedContent(applyReviewedDecisions(legacy.items, authored.examples, decisions), decisions);
for (const [key, name] of Object.entries({ legacy: 'source/legacy-annotations.json', authored: 'source/authored-annotations.json', decisions: 'review-decisions.json' })) {
  assert.equal(dataset.sourceSha256[key], sha256(await readFile(new URL(name, base))), `Source changed: ${name}.`);
}
const caseBytes = await readFile(new URL('../tests/fixtures/image-pretraining-v2/cases.json', import.meta.url));
assert.equal(dataset.sourceManifestSha256, sha256(caseBytes), 'Original corpus changed.');
const actual = auditMeaningTaxonomy(dataset, review, JSON.parse(caseBytes));
assert.deepEqual(review.audit, actual, 'Stored audit summary is stale.');
console.log(JSON.stringify(actual, null, 2));
