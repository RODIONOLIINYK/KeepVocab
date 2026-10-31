import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDecisions } from './encode-image-crops.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sourceCases = { cases: [] };
const entries = [];
const decisions = [];
for (let index = 1; index <= 385; index++) {
  const id = `case-${index}`;
  const parentSha256 = hash(`parent-${index}`);
  const cropSha256 = hash(`crop-${index}`);
  const candidate = { id: `candidate-${index}`, file: `images/${index}.jpg`, sha256: parentSha256 };
  sourceCases.cases.push({
    id,
    meaningId: `meaning-${index}`,
    familyId: `family-${index}`,
    split: 'train',
    word: { word: `word-${index}`, definition: `Definition ${index}.` },
    feedback: { selected: [candidate.id] },
    candidates: [candidate],
  });
  entries.push({ reviewIndex: index, caseId: id, meaningId: `meaning-${index}`,
    split: 'train', parentCandidateId: candidate.id, parentPath: candidate.file,
    parentSha256, cropSha256 });
  decisions.push({ reviewIndex: index, parentSha256, cropSha256,
    status: index === 1 ? 'approved' : 'rejected', reason: 'Synthetic validation case.' });
}
const casesBytes = Buffer.from(JSON.stringify(sourceCases));
const reviewManifest = { entries };
const reviewBytes = Buffer.from(JSON.stringify(reviewManifest));
const sourceTaxonomy = { items: [] };
const taxonomyBytes = Buffer.from(JSON.stringify(sourceTaxonomy));
const decisionFile = (items = decisions, taxonomy = sourceTaxonomy) => {
  const bytes = Buffer.from(JSON.stringify(taxonomy));
  return Buffer.from(JSON.stringify({
  sourceManifestSha256: hash(casesBytes),
  draftManifestSha256: hash(reviewBytes),
  meaningTaxonomySha256: hash(bytes),
  reviewType: 'AI visual review; not human-expert ground truth',
  reviewedCount: 385,
  decisions: items,
}));
};
const args = { casesBytes, reviewBytes, cropManifest: reviewManifest, sourceCases,
  sourceTaxonomy, taxonomyBytes };

assert.equal(validateDecisions({ ...args, decisionsBytes: decisionFile() }).decisionsByIndex.size, 385);
const wrongHash = decisions.map(row => ({ ...row }));
wrongHash[10].cropSha256 = '0'.repeat(64);
assert.throws(() => validateDecisions({ ...args, decisionsBytes: decisionFile(wrongHash) }), /crop hash/);
assert.throws(() => validateDecisions({ ...args, decisionsBytes: decisionFile(decisions.slice(1)) }), /exactly one decision/);
const taxonomyHoldout = { items: [{ word: 'a different headword', familyId: 'family-1',
  split: 'validation', sourceCaseIds: [] }] };
assert.throws(() => validateDecisions({ ...args, sourceTaxonomy: taxonomyHoldout,
  taxonomyBytes: Buffer.from(JSON.stringify(taxonomyHoldout)),
  decisionsBytes: decisionFile(decisions, taxonomyHoldout) }), /family overlaps/);
const quarantine = { items: [{ word: 'a different headword', familyId: 'other-family',
  split: 'quarantine', sourceCaseIds: ['case-1'] }] };
const rejectedFirst = decisions.map(row => ({ ...row }));
rejectedFirst[0].status = 'rejected';
assert.equal(validateDecisions({ ...args, sourceTaxonomy: quarantine,
  taxonomyBytes: Buffer.from(JSON.stringify(quarantine)),
  decisionsBytes: decisionFile(rejectedFirst, quarantine) }).decisionsByIndex.size, 385);
console.log('Image crop decision validation passed (complete coverage, exact hashes, missing-row rejection).');
