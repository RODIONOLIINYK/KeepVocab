import { readFile, writeFile } from 'node:fs/promises';
import { applyReviewedDecisions, assertReviewedContent, assignMeaningPartitions, annotationHash,
  meaningKey, sha256, MEANING_CATEGORIES, auditMeaningTaxonomy } from './lib/meaning-taxonomy.mjs';

const base = new URL('../tests/fixtures/meaning-taxonomy/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));
const legacy = await read('source/legacy-annotations.json');
const authored = await read('source/authored-annotations.json');
const decisions = await read('review-decisions.json');
const caseBytes = await readFile(new URL('../tests/fixtures/image-pretraining-v2/cases.json', import.meta.url));
const cases = JSON.parse(caseBytes);
const reviewed = applyReviewedDecisions(legacy.items, authored.examples, decisions);
assertReviewedContent(reviewed, decisions);
const caseIds = new Map();
for (const item of cases.cases) {
  const key = meaningKey({ word: item.word.word, partOfSpeech: item.word.partOfSpeech, definition: item.word.definition });
  if (!caseIds.has(key)) caseIds.set(key, []); caseIds.get(key).push(item.id);
}
const dataset = {
  schemaVersion: 1, task: 'meaning-category-membership', categories: MEANING_CATEGORIES,
  targetEncoding: 'multilabel-binary-in-category-order', trained: false, personalPreference: false,
  annotationPolicy: 'docs/meaning-conditioning-plan.md',
  sourceManifestSha256: sha256(caseBytes), reviewedContentSha256: decisions.reviewedContentSha256,
  sourceSha256: {
    legacy: sha256(await readFile(new URL('source/legacy-annotations.json', base))),
    authored: sha256(await readFile(new URL('source/authored-annotations.json', base))),
    decisions: sha256(await readFile(new URL('review-decisions.json', base)))
  },
  splitPolicy: 'Connected headword and original-family components; legacy cross-split conflicts quarantined; new groups deterministic 60/20/20 hash buckets.',
  limitations: [
    'Text meanings only: no new images or verified image negatives.',
    'AI-authored supplement and AI-reviewed annotations are not expert-human ground truth.',
    'Pilot sample sizes, class imbalance, shared authorship and English definition style limit generalization.',
    'Multiple labels describe useful evidence routes, not a requirement that every photo show all categories.',
    'Abstract meanings and uncertain classifier predictions require different handling.'
  ],
  items: assignMeaningPartitions(reviewed).map(row => {
    const item = { id: `meaning-${sha256(meaningKey(row)).slice(0, 16)}`, ...row,
      ...(row.sourceKind === 'legacy' ? { sourceCaseIds: caseIds.get(meaningKey(row)) } : {}),
      targets: MEANING_CATEGORIES.map(category => Number(row.labels.includes(category))) };
    return { ...item, review: { status: 'reviewed', type: decisions.reviewType,
      reviewer: decisions.reviewer, annotationSha256: annotationHash(item) } };
  })
};
const review = {
  schemaVersion: 1, reviewType: decisions.reviewType, reviewer: decisions.reviewer,
  reviewedCount: dataset.items.length, reviewedContentSha256: decisions.reviewedContentSha256,
  datasetSha256: sha256(JSON.stringify(dataset)),
  mechanicalChecksAreNotSemanticProof: true,
  classifierTrained: false, adaptersTrained: false, productionModelChanged: false,
  reviewScope: decisions.reviewScope, policyDecisions: decisions.policyDecisions,
  audit: null
};
review.audit = auditMeaningTaxonomy(dataset, review, cases);
await writeFile(new URL('dataset.json', base), `${JSON.stringify(dataset, null, 2)}\n`);
await writeFile(new URL('review.json', base), `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify(review.audit, null, 2));
