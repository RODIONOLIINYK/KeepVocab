import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEANING_CATEGORIES, normalizeHeadword, sha256 } from './lib/meaning-taxonomy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = 'tests/fixtures/meaning-taxonomy/policy-v2';
const sourcePath = 'tests/fixtures/meaning-taxonomy/regularized-expansion/dataset.json';
const annotationsPath = `${directory}/new-annotations.json`;
const decisionsPath = `${directory}/review-decisions.json`;
const policyPath = `${directory}/POLICY.md`;
const paths = {
  dataset: `${directory}/dataset.json`, manifest: `${directory}/manifest.json`,
  review: `${directory}/review.json`, source: sourcePath,
  annotations: annotationsPath, decisions: decisionsPath, policy: policyPath
};
const readBytes = path => readFile(resolve(root, path));
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const recordHash = row => sha256(JSON.stringify(row));
const [datasetBytes, manifestBytes, reviewBytes, sourceBytes, annotationBytes, decisionBytes, policyBytes] = await Promise.all([
  readBytes(paths.dataset), readBytes(paths.manifest), readBytes(paths.review), readBytes(paths.source),
  readBytes(paths.annotations), readBytes(paths.decisions), readBytes(paths.policy)
]);
const dataset = parse(datasetBytes), manifest = parse(manifestBytes), review = parse(reviewBytes);
const source = parse(sourceBytes), annotations = parse(annotationBytes), decisions = parse(decisionBytes);

assert(Array.isArray(dataset.items), 'Policy v2 dataset must contain items.');
assert(Array.isArray(annotations), 'Policy v2 new annotations must be an array.');
assert(Array.isArray(decisions), 'Policy v2 review decisions must be an array.');
assert.equal(dataset.task, 'meaning-category-membership');
assert.equal(dataset.annotationPolicyVersion, 'v2');
assert.deepEqual(dataset.categories, MEANING_CATEGORIES);
assert.equal(dataset.targetEncoding, 'multilabel-binary-in-category-order');
assert.equal(dataset.items.length, 1780, 'Policy v2 dataset must contain 1,780 rows.');
assert.equal(source.items.length, 1420, 'Frozen v1 regularized source must contain 1,420 rows.');
assert.equal(annotations.length, 360, 'Exactly 360 fresh meanings are required.');
assert.equal(review.reviewType, 'AI semantic review; not human-expert ground truth');
assert.equal(review.newAnnotationsFileSha256, sha256(annotationBytes), 'New annotation review hash changed.');
assert.equal(review.decisionsFileSha256, sha256(decisionBytes), 'Policy decision review hash changed.');
assert.equal(review.policyFileSha256, sha256(policyBytes), 'Policy text review hash changed.');
assert.equal(decisions.length, 1280, 'Exactly 1,280 old meaning units require policy review.');

const sourceById = new Map(source.items.map((row, index) => [row.id, { row, index }]));
assert.equal(sourceById.size, source.items.length, 'Duplicate IDs in frozen source dataset.');
const annotationsById = new Map(annotations.map(row => [row.id, row]));
assert.equal(annotationsById.size, annotations.length, 'Duplicate IDs in new annotations.');
const decisionsById = new Map(decisions.map(row => [row.id, row]));
assert.equal(decisionsById.size, decisions.length, 'Duplicate policy review decisions.');
const policyRowsById = new Map(dataset.items.map(row => [row.id, row]));
assert.equal(policyRowsById.size, dataset.items.length, 'Duplicate IDs in policy v2 dataset.');
const expectedDecisionIds = new Set(source.items.filter(row => row.kind !== 'paraphrase').map(row => row.id));
assert.deepEqual(new Set(decisionsById.keys()), expectedDecisionIds,
  'Review decisions must cover every nonparaphrase v1 meaning unit exactly once.');
for (const decision of decisions) {
  assert.equal(decision.primaryReview?.status, 'reviewed', `Primary review incomplete for ${decision.id}.`);
  const old = sourceById.get(decision.id)?.row;
  assert(old, `Unknown policy decision ID ${decision.id}.`);
  assert.deepEqual(decision.oldLabels, old.labels, `Decision's old label set is stale for ${decision.id}.`);
  assert.equal(decision.word, old.word, `Decision word changed for ${decision.id}.`);
  assert.equal(decision.definition, old.definition, `Decision definition changed for ${decision.id}.`);
  assert(Array.isArray(decision.proposedLabels) && decision.proposedLabels.length > 0,
    `Missing proposed labels for ${decision.id}.`);
  assert.deepEqual(decision.proposedLabels,
    MEANING_CATEGORIES.filter(category => decision.proposedLabels.includes(category)),
    `Decision labels must be unique and in category order for ${decision.id}.`);
  assert(decision.reason?.trim(), `Missing policy reason for ${decision.id}.`);
}

const recordHashLists = new Map([
  [paths.source, source.items.map(recordHash)],
  [paths.annotations, annotations.map(recordHash)]
]);
const rowsById = new Map(), sourceCoverage = new Set(), meaningUnits = new Map();
const rowsBySplit = new Map();
const newWords = new Set(), oldWords = new Set(source.items.map(row => normalizeHeadword(row.word)));
const oldIdentities = new Set();
for (const row of source.items) {
  for (const key of ['word', 'familyId', 'extraFamilyKeys']) {
    const value = row[key];
    if (Array.isArray(value)) for (const item of value) oldIdentities.add(normalizeHeadword(item));
    else if (value) oldIdentities.add(normalizeHeadword(value));
  }
}
const oldSourceIds = new Set(source.items.map(row => row.id));
const oldSourceSplit = row => row.split === 'train' ? 'train'
  : row.split === 'validation' || row.split === 'legacy-validation' ? 'retired-validation'
    : row.split === 'test' || row.split === 'legacy-test' ? 'retired-test'
      : row.split === 'quarantine' ? 'quarantine' : null;
const expectedSplitCounts = Object.fromEntries(
  ['train', 'retired-validation', 'retired-test', 'validation', 'test', 'quarantine'].map(split => [split, 0]));
let oldCount = 0, oldParaphraseCount = 0, newCount = 0, changedMeaningUnits = 0, changedRows = 0;

for (const row of dataset.items) {
  assert(row.id && !rowsById.has(row.id), `Missing or duplicate dataset ID ${row.id}.`);
  rowsById.set(row.id, row);
  assert(row.annotationPolicyVersion === 'v2', `Wrong annotation policy version for ${row.id}.`);
  assert(row.word?.trim() && row.partOfSpeech?.trim() && row.definition?.trim() && row.familyId?.trim(),
    `Missing meaning text for ${row.id}.`);
  assert(Array.isArray(row.labels) && row.labels.length > 0, `Missing labels for ${row.id}.`);
  assert.deepEqual(row.labels, MEANING_CATEGORIES.filter(category => row.labels.includes(category)),
    `Labels must be unique and ordered for ${row.id}.`);
  assert.deepEqual(row.targets, MEANING_CATEGORIES.map(category => Number(row.labels.includes(category))),
    `Targets do not encode label membership for ${row.id}.`);
  assert(row.anchorCategory && row.labels.includes(row.anchorCategory), `Invalid anchor for ${row.id}.`);
  assert(row.groupId?.trim(), `Missing group ID for ${row.id}.`);
  assert(['train', 'retired-validation', 'retired-test', 'validation', 'test', 'quarantine'].includes(row.split),
    `Invalid policy v2 split for ${row.id}.`);
  expectedSplitCounts[row.split]++;
  if (!rowsBySplit.has(row.split)) rowsBySplit.set(row.split, []);
  rowsBySplit.get(row.split).push(row);
  const unit = row.meaningUnitId;
  assert(unit?.trim(), `Missing meaningUnitId for ${row.id}.`);
  assert(Number.isFinite(row.sampleWeight) && row.sampleWeight > 0, `Invalid sampleWeight for ${row.id}.`);
  if (!meaningUnits.has(unit)) meaningUnits.set(unit, []);
  meaningUnits.get(unit).push(row);

  const provenance = row.sourceRecord;
  assert(provenance && typeof provenance.file === 'string' && typeof provenance.id === 'string'
    && typeof provenance.sha256 === 'string', `Missing source-record provenance for ${row.id}.`);
  const coverageKey = `${provenance.file}\0${provenance.id}`;
  assert(!sourceCoverage.has(coverageKey), `Duplicate source-record reference ${provenance.file}:${provenance.id}.`);
  sourceCoverage.add(coverageKey);

  if (provenance.file === paths.source) {
    const sourceEntry = sourceById.get(provenance.id);
    assert(sourceEntry, `Unknown v1 source ID ${provenance.id}.`);
    const { row: original, index: sourceIndex } = sourceEntry;
    assert.equal(provenance.sha256, recordHashLists.get(paths.source)[sourceIndex],
      `Stale v1 source row hash for ${provenance.id}.`);
    for (const key of ['id', 'word', 'partOfSpeech', 'definition', 'familyId', 'sourceCaseIds']) {
      assert.deepEqual(row[key], original[key], `Frozen v1 source field ${key} changed for ${row.id}.`);
    }
    assert.equal(row.sourceSplit, original.split, `Original v1 split changed for ${row.id}.`);
    assert.equal(row.sourceGroupId, original.groupId, `Original v1 group changed for ${row.id}.`);
    assert.equal(row.previousAnnotation?.policyVersion, 'v1', `Missing prior annotation version for ${row.id}.`);
    assert.deepEqual(row.previousAnnotation?.labels, original.labels, `Prior labels changed for ${row.id}.`);
    assert.equal(row.review?.status, 'reviewed', `Policy review incomplete for ${row.id}.`);
    assert.equal(row.review?.type, review.reviewType, `Policy review type changed for ${row.id}.`);
    assert.equal(row.review?.decisionId, original.kind === 'paraphrase' ? original.sourceId : original.id,
      `Policy review decision link changed for ${row.id}.`);
    assert.equal(row.review?.policyFileSha256, review.policyFileSha256, `Policy source link changed for ${row.id}.`);
    const parentId = original.kind === 'paraphrase' ? original.sourceId : original.id;
    const decision = decisionsById.get(parentId);
    assert(decision, `Missing review decision for source unit ${parentId}.`);
    assert.deepEqual(row.labels, decision.proposedLabels, `Revised labels disagree with review for ${row.id}.`);
    const expectedAnchor = decision.proposedLabels.includes(original.anchorCategory)
      ? original.anchorCategory : decision.proposedLabels[0];
    assert.equal(row.anchorCategory, expectedAnchor, `Revised anchor differs from reviewed labels for ${row.id}.`);
    assert.equal(row.primaryClass, expectedAnchor, `Revised primary class differs from reviewed anchor for ${row.id}.`);
    changedRows += Number(JSON.stringify(original.labels) !== JSON.stringify(row.labels));
    if (original.kind === 'paraphrase') {
      assert(oldSourceIds.has(original.sourceId), `Paraphrase has unknown parent ${original.sourceId}.`);
      const parent = policyRowsById.get(original.sourceId);
      assert(parent, `Paraphrase parent must be present in the policy v2 dataset: ${row.id}.`);
      assert.equal(row.meaningUnitId, parent.meaningUnitId,
        `Paraphrase meaning unit differs from parent for ${row.id}.`);
      assert.equal(row.groupId, parent.groupId, `Paraphrase group differs from parent for ${row.id}.`);
      assert.deepEqual(row.labels, parent.labels, `Paraphrase labels differ from parent for ${row.id}.`);
      oldParaphraseCount++;
    } else {
      assert.deepEqual(decision.oldLabels, original.labels, `Stale old labels in decision for ${row.id}.`);
      changedMeaningUnits += Number(JSON.stringify(decision.oldLabels) !== JSON.stringify(decision.proposedLabels));
    }
    const expectedSplit = oldSourceSplit(original);
    assert(expectedSplit, `Unknown protected source partition ${original.split} for ${row.id}.`);
    if (expectedSplit === 'train') assert(['train', 'quarantine'].includes(row.split),
      `Old training meaning moved into a protected evaluation split: ${row.id}.`);
    else assert([expectedSplit, 'quarantine'].includes(row.split),
      `Old held-out meaning was exposed to training or moved across held-out partitions: ${row.id}.`);
    if (row.split === 'quarantine') assert(row.quarantineReason?.trim(), `Quarantine reason is missing for ${row.id}.`);
    oldCount++;
  } else {
    assert.equal(provenance.file, paths.annotations, `Unknown new source file for ${row.id}.`);
    const annotation = annotationsById.get(provenance.id);
    assert(annotation, `Unknown annotation source ID ${provenance.id}.`);
    const annotationIndex = annotations.indexOf(annotation);
    assert.equal(provenance.sha256, recordHashLists.get(paths.annotations)[annotationIndex],
      `Stale annotation source hash for ${provenance.id}.`);
    for (const key of ['id', 'word', 'partOfSpeech', 'definition', 'familyId', 'labels', 'anchorCategory']) {
      assert.deepEqual(row[key], annotation[key], `New reviewed field ${key} changed for ${row.id}.`);
    }
    assert.equal(row.kind, 'new-meaning', `Fresh annotation kind changed for ${row.id}.`);
    assert.equal(row.meaningUnitId, row.id, `Fresh meaning must own its meaning unit: ${row.id}.`);
    assert.equal(annotation.review?.status, 'reviewed', `New meaning review incomplete for ${row.id}.`);
    assert.equal(annotation.review?.type, review.reviewType, `New meaning review type changed for ${row.id}.`);
    const normalized = normalizeHeadword(row.word);
    assert(!oldWords.has(normalized), `New headword duplicates an old word: ${row.word}.`);
    assert(!newWords.has(normalized), `Repeated new headword ${row.word}.`);
    newWords.add(normalized);
    const newFamilyKeys = [normalized, row.familyId, ...(row.extraFamilyKeys || [])].map(normalizeHeadword);
    const identityCollision = newFamilyKeys.some(key => oldIdentities.has(key));
    assert(!identityCollision || row.relatedExistingId || row.sourceId,
      `New headword/family alias overlaps an old identity without an explicit link: ${row.word}.`);
    if (row.split === 'validation' || row.split === 'test') {
      assert(!row.relatedExistingId && !row.sourceId,
        `Fresh ${row.split} meaning is linked to an old or alternate source: ${row.id}.`);
    }
    newCount++;
  }
}

assert.equal(oldCount, 1420, 'All 1,420 v1 source rows must be preserved exactly once.');
assert.equal(oldParaphraseCount, 140, 'All 140 existing paraphrases must be retained.');
assert.equal(newCount, 360, 'All 360 reviewed new meanings must be retained exactly once.');
assert.equal(sourceCoverage.size, dataset.items.length, 'Source provenance coverage is incomplete.');
for (const original of source.items) assert(sourceCoverage.has(`${paths.source}\0${original.id}`),
  `Missing v1 source row ${original.id}.`);
for (const annotation of annotations) assert(sourceCoverage.has(`${paths.annotations}\0${annotation.id}`),
  `Missing new annotation ${annotation.id}.`);

for (const split of ['validation', 'test']) {
  const rows = rowsBySplit.get(split) || [];
  assert.equal(rows.length, split === 'validation' ? 60 : 120,
    `Fresh ${split} size changed.`);
  assert(rows.every(row => row.sourceRecord.file === paths.annotations && row.kind === 'new-meaning'),
    `Fresh ${split} must contain only independent new meanings.`);
  for (const category of MEANING_CATEGORIES) {
    const expected = split === 'validation' ? 10 : 20;
    assert.equal(rows.filter(row => row.anchorCategory === category).length, expected,
      `Fresh ${split} must contain ${expected} ${category} anchors.`);
  }
  const domainCounts = category => Object.fromEntries(['artifact', 'material', 'organism', 'built-place', 'natural-place',
    'physical-relation', 'social-role'].map(domain => [domain,
      rows.filter(row => row.anchorCategory === category && row.domain === domain).length]));
  const entityDomains = domainCounts('entity');
  assert.deepEqual(Object.fromEntries(Object.entries(entityDomains).filter(([, count]) => count)),
    split === 'validation' ? { artifact: 6, material: 2, organism: 2 }
      : { artifact: 12, material: 4, organism: 4 }, `Fresh ${split} entity domain coverage changed.`);
  const placeDomains = domainCounts('place');
  assert.deepEqual(Object.fromEntries(Object.entries(placeDomains).filter(([, count]) => count)),
    split === 'validation' ? { 'built-place': 6, 'natural-place': 4 }
      : { 'built-place': 12, 'natural-place': 8 }, `Fresh ${split} place domain coverage changed.`);
  const relationDomains = domainCounts('relation');
  assert.deepEqual(Object.fromEntries(Object.entries(relationDomains).filter(([, count]) => count)),
    split === 'validation' ? { 'physical-relation': 5, 'social-role': 5 }
      : { 'physical-relation': 10, 'social-role': 10 }, `Fresh ${split} relation domain coverage changed.`);
}
for (const [unit, members] of meaningUnits) {
  if (members.every(row => row.split === 'train')) {
    const sum = members.reduce((total, row) => total + row.sampleWeight, 0);
    assert(Math.abs(sum - 1) <= 1e-8, `Training meaning unit ${unit} has weight sum ${sum}, expected 1.`);
  } else {
    assert(members.every(row => row.sampleWeight === 1), `Nontraining rows must have unit weight for ${unit}.`);
  }
}

// Rebuild the identity graph so no word, family, source family, or explicit
// link can bridge partitions or be split across recomputed group IDs.
const parents = dataset.items.map((_, index) => index);
const rootOf = index => {
  if (parents[index] !== index) parents[index] = rootOf(parents[index]);
  return parents[index];
};
const join = (a, b) => { parents[rootOf(b)] = rootOf(a); };
const identities = new Map(), positions = new Map(dataset.items.map((row, index) => [row.id, index]));
for (let index = 0; index < dataset.items.length; index++) {
  const row = dataset.items[index];
  const keys = [['meaning', row.word], ['meaning', row.familyId],
    ...(row.extraFamilyKeys || []).map(value => ['meaning', value]),
    ...(row.sourceGroupId ? [['oldgroup', row.sourceGroupId]] : [])];
  for (const [kind, value] of keys) {
    const key = `${kind}:${normalizeHeadword(value)}`;
    assert(key.split(':')[1], `Empty grouping identity on ${row.id}.`);
    if (identities.has(key)) join(index, identities.get(key)); else identities.set(key, index);
  }
  for (const linkedId of [row.sourceId, row.relatedExistingId]) {
    if (!linkedId) continue;
    const linkedIndex = positions.get(linkedId);
    assert(Number.isInteger(linkedIndex), `Unknown linked source ID ${linkedId} on ${row.id}.`);
    join(index, linkedIndex);
  }
}
const components = new Map();
for (let i = 0; i < dataset.items.length; i++) {
  const key = rootOf(i);
  if (!components.has(key)) components.set(key, []);
  components.get(key).push(dataset.items[i]);
}
for (const members of components.values()) {
  const groupIds = new Set(members.map(row => row.groupId));
  const splits = new Set(members.map(row => row.split));
  assert.equal(groupIds.size, 1, `Connected identity has multiple group IDs: ${members[0].word}.`);
  assert.equal(splits.size, 1, `Connected identity leaks across splits: ${members[0].word}.`);
  const hasAmbiguity = members.some(row => row.ambiguous);
  const protectedSplits = new Set(members.filter(row => row.sourceRecord.file === paths.source)
    .map(row => oldSourceSplit(sourceById.get(row.sourceRecord.id).row)));
  const expectedGroupSplit = hasAmbiguity || protectedSplits.size > 1 ? 'quarantine'
    : protectedSplits.size === 1 ? [...protectedSplits][0] : null;
  if (expectedGroupSplit) assert.equal(members[0].split, expectedGroupSplit,
    `Connected group did not preserve its protected exposure/ambiguity: ${members[0].word}.`);
  if (members[0].split === 'quarantine') {
    assert(hasAmbiguity || protectedSplits.size > 1 || protectedSplits.has('quarantine'),
      `Quarantined group has no ambiguity or protected-partition conflict: ${members[0].word}.`);
    assert(members.every(row => row.quarantineReason?.trim()),
      `Quarantined connected group is missing a reason: ${members[0].word}.`);
  }
  if (['validation', 'test'].includes(members[0].split)) {
    assert(members.every(row => row.sourceRecord.file === paths.annotations && !row.relatedExistingId && !row.sourceId),
      `Fresh group is connected to old or paraphrase meaning: ${members[0].groupId}.`);
  }
}

const actualCounts = Object.fromEntries([...rowsBySplit].map(([split, rows]) => [split, rows.length]));
assert.deepEqual(dataset.counts, actualCounts, 'Dataset split counts are stale.');
assert.deepEqual(manifest.counts, actualCounts, 'Manifest split counts are stale.');
const sourceHashes = {
  [paths.source]: sha256(sourceBytes), [paths.annotations]: sha256(annotationBytes),
  [paths.decisions]: sha256(decisionBytes), [paths.policy]: sha256(policyBytes)
};
assert.deepEqual(dataset.sourceFilesSha256, sourceHashes, 'Dataset source file hashes are incomplete or stale.');
assert.deepEqual(manifest.sourceFilesSha256, sourceHashes, 'Manifest source file hashes are stale.');
for (const [path, expectedHash] of Object.entries(source.sourceFilesSha256 || {})) {
  assert.equal(expectedHash, sha256(await readBytes(path)), `Frozen v1 source dependency changed: ${path}.`);
}
assert.deepEqual(dataset.quarantinedSourceIds, source.quarantinedSourceIds,
  'Historical quarantine source IDs changed.');
assert.equal(manifest.datasetFileSha256, sha256(datasetBytes), 'Manifest dataset hash is stale.');
assert.equal(manifest.policyFileSha256, sourceHashes[paths.policy], 'Manifest policy hash is stale.');
if (review.datasetFileSha256 !== undefined) assert.equal(review.datasetFileSha256, sha256(datasetBytes),
  'Review report dataset hash is stale.');
const reviewSourceHash = review.sourceDatasetFileSha256 ?? review.sourceDatasetSha256
  ?? review.baseDatasetFileSha256 ?? review.baseDatasetSha256 ?? review.sourceFilesSha256?.[paths.source];
assert.equal(reviewSourceHash, sourceHashes[paths.source],
  'Review report must bind the frozen regularized source dataset.');
assert.equal(manifest.sourceRowCount, 1420);
assert.equal(manifest.reviewedSourceMeaningUnits, 1280);
assert.equal(manifest.newMeaningCount, 360);
assert.equal(manifest.trainingMeaningUnits, [...meaningUnits].filter(([, members]) => members.every(row => row.split === 'train')).length,
  'Manifest training meaning-unit count is stale.');
const eligibleFreshGroups = [...components.values()].filter(members => members.every(row => row.sourceRecord.file === paths.annotations)
  && members.every(row => !row.ambiguous) && members[0].split !== 'quarantine');
assert.equal(manifest.freshGroups, eligibleFreshGroups.length, 'Manifest fresh group count is stale.');
assert.equal(manifest.changedRowCount, changedRows,
  'Manifest changed row count is stale.');
assert.equal((manifest.labelChanges || []).length, changedRows,
  'Manifest label-change ledger is incomplete.');
for (const change of manifest.labelChanges || []) {
  const row = rowsById.get(change.id);
  assert(row, `Unknown ID in label-change ledger: ${change.id}.`);
  assert.deepEqual(change.newLabels, row.labels, `Label-change ledger is stale for ${change.id}.`);
  assert(change.reason?.trim(), `Missing label-change reason for ${change.id}.`);
}
const quarantined = new Map((manifest.quarantine || []).map(item => [item.groupId, item]));
const quarantinedRows = dataset.items.filter(row => row.split === 'quarantine');
assert.equal(quarantined.size, new Set(quarantinedRows.map(row => row.groupId)).size, 'Manifest quarantine group count is stale.');
for (const rows of components.values()) if (rows[0].split === 'quarantine') {
  const entry = quarantined.get(rows[0].groupId);
  assert(entry, `Missing quarantine manifest entry for ${rows[0].groupId}.`);
  assert.deepEqual([...entry.ids].sort(), rows.map(row => row.id).sort(), `Quarantine members changed for ${rows[0].groupId}.`);
  assert(rows.every(row => row.quarantineReason === entry.reason), `Quarantine reason changed for ${rows[0].groupId}.`);
}
const weighted = Object.fromEntries([...rowsBySplit].map(([split, rows]) => [split,
  Object.fromEntries(MEANING_CATEGORIES.map(category => [category,
    rows.reduce((total, row) => total + (row.labels.includes(category) ? row.sampleWeight : 0), 0)]))]));
assert.deepEqual(dataset.weightedPositiveMemberships, weighted,
  'Dataset weighted positive memberships are stale.');
assert.deepEqual(manifest.weightedPositiveMemberships, weighted,
  'Manifest weighted positive memberships are stale.');

const summary = {
  count: dataset.items.length,
  counts: actualCounts,
  reviewedOldMeaningUnits: decisions.length,
  oldRows: oldCount,
  oldParaphrases: oldParaphraseCount,
  newMeaningCount: newCount,
  changedMeaningUnits,
  changedRows,
  connectedGroupCount: components.size,
  freshAnchorCounts: Object.fromEntries(['validation', 'test'].map(split => [split,
    Object.fromEntries(MEANING_CATEGORIES.map(category => [category,
      (rowsBySplit.get(split) || []).filter(row => row.anchorCategory === category).length]))])),
  freshDomainCounts: Object.fromEntries(['validation', 'test'].map(split => [split,
    Object.fromEntries(['artifact', 'material', 'organism', 'built-place', 'natural-place', 'physical-relation', 'social-role']
      .map(domain => [domain, (rowsBySplit.get(split) || []).filter(row => row.domain === domain).length]))])),
  datasetFileSha256: sha256(datasetBytes),
  note: 'Integrity audit only. This verifies provenance, review coverage and partitioning, not semantic accuracy.'
};
console.log(JSON.stringify(summary, null, 2));
