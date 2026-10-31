import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEANING_CATEGORIES, normalizeHeadword, sha256 } from './lib/meaning-taxonomy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = 'tests/fixtures/meaning-taxonomy/expanded-1000';
const paths = {
  base: 'tests/fixtures/meaning-taxonomy/dataset.json',
  supplement: 'tests/fixtures/meaning-taxonomy/supplement/dataset.json',
  expanded: `${directory}/new-annotations.json`
};
const readBytes = async path => readFile(resolve(root, path));
const parse = bytes => JSON.parse(bytes.toString('utf8'));
const recordHash = row => sha256(JSON.stringify(row));
const [datasetBytes, reviewBytes, expandedBytes, baseBytes, supplementBytes] = await Promise.all([
  readBytes(`${directory}/dataset.json`), readBytes(`${directory}/review.json`),
  readBytes(paths.expanded), readBytes(paths.base), readBytes(paths.supplement)
]);
const dataset = parse(datasetBytes), review = parse(reviewBytes), annotations = parse(expandedBytes);
const base = parse(baseBytes), supplement = parse(supplementBytes);

assert.equal(dataset.task, 'meaning-category-membership');
assert.deepEqual(dataset.categories, MEANING_CATEGORIES);
assert.equal(dataset.targetEncoding, 'multilabel-binary-in-category-order');
assert.equal(dataset.items.length, 1000, 'Expanded dataset must contain exactly 1000 meanings.');
assert.equal(review.reviewType, 'AI semantic review; not human-expert ground truth');
assert.equal(review.reviewedCount, 531, 'Exactly 531 new meanings require primary review.');
assert.equal(annotations.items.length, 531, 'New annotation count changed.');
assert.equal(review.newAnnotationsFileSha256, sha256(expandedBytes), 'New annotation source changed after review.');
if (review.datasetFileSha256 !== undefined) {
  assert.equal(review.datasetFileSha256, sha256(datasetBytes), 'Expanded dataset review hash changed.');
}

const expectedSources = {
  [paths.base]: baseBytes,
  [paths.supplement]: supplementBytes,
  [paths.expanded]: expandedBytes
};
assert(dataset.sourceFilesSha256 && typeof dataset.sourceFilesSha256 === 'object',
  'Expanded dataset must record source file hashes.');
for (const [path, bytes] of Object.entries(expectedSources)) {
  assert.equal(dataset.sourceFilesSha256[path], sha256(bytes), `Source file hash changed: ${path}.`);
}
for (const [path, expectedHash] of Object.entries(dataset.sourceFilesSha256)) {
  assert.equal(expectedHash, sha256(await readBytes(path)), `Unknown or stale source file hash: ${path}.`);
}

const oldSources = new Map();
for (const [path, source] of [[paths.base, base], [paths.supplement, supplement]]) {
  for (const row of source.items) {
    assert(!oldSources.has(`${path}\0${row.id}`), `Duplicate source ID in ${path}: ${row.id}.`);
    oldSources.set(`${path}\0${row.id}`, { path, row });
  }
}
const newSources = new Map(annotations.items.map(row => [row.id, row]));
assert.equal(newSources.size, annotations.items.length, 'Duplicate new annotation IDs.');
const baseQuarantine = base.items.filter(row => row.split === 'quarantine');
assert.equal(baseQuarantine.length, 5, 'The five known quarantined legacy meanings changed.');
const quarantineIds = new Set(baseQuarantine.flatMap(row => [row.id, ...(row.sourceCaseIds || [])]));
const declaredQuarantine = dataset.quarantinedSourceIds;
assert(Array.isArray(declaredQuarantine), 'Dataset must list quarantined source IDs.');
assert.equal(declaredQuarantine.length, 5, 'Exactly five quarantined source IDs must be retained outside the dataset.');
for (const id of declaredQuarantine) {
  assert(quarantineIds.has(id), `Unknown quarantined source ID ${id}.`);
}

const sourceIdsSeen = new Set(), ids = new Set(), exactMeanings = new Set();
const rowsBySplit = new Map();
const counts = Object.fromEntries(['train', 'validation', 'test', 'legacy-validation', 'legacy-test']
  .map(split => [split, 0]));
const trainPositives = Object.fromEntries(MEANING_CATEGORIES.map(category => [category, 0]));
let oldCount = 0, newCount = 0;
for (const row of dataset.items) {
  assert(row.id && !ids.has(row.id), `Missing or duplicate dataset ID ${row.id}.`); ids.add(row.id);
  assert(row.word?.trim() && row.partOfSpeech?.trim() && row.definition?.trim() && row.familyId?.trim(),
    `Missing meaning fields for ${row.id}.`);
  const key = JSON.stringify([normalizeHeadword(row.word), normalizeHeadword(row.partOfSpeech), row.definition.trim()]);
  assert(!exactMeanings.has(key), `Duplicate exact meaning ${row.word}.`); exactMeanings.add(key);
  assert(Array.isArray(row.labels) && row.labels.length > 0, `Missing labels for ${row.id}.`);
  assert.deepEqual(row.labels, MEANING_CATEGORIES.filter(category => row.labels.includes(category)),
    `Labels must be unique and in category order for ${row.id}.`);
  assert.deepEqual(row.targets, MEANING_CATEGORIES.map(category => Number(row.labels.includes(category))),
    `Targets do not independently encode label membership for ${row.id}.`);
  assert(row.labels.includes(row.anchorCategory), `Anchor category is not a positive target for ${row.id}.`);
    assert(row.groupId?.trim(), `Missing group ID for ${row.id}.`);
  assert(['train', 'validation', 'test', 'legacy-validation', 'legacy-test'].includes(row.split),
    `Invalid expanded split for ${row.id}.`);
  counts[row.split]++;
  if (row.split === 'train') for (const label of row.labels) trainPositives[label]++;
  const record = row.sourceRecord;
  assert(record && typeof record.file === 'string' && typeof record.id === 'string' && typeof record.sha256 === 'string',
    `Missing source record provenance for ${row.id}.`);
  const sourceKey = `${record.file}\0${record.id}`;
  assert(!sourceIdsSeen.has(sourceKey), `Source record is duplicated: ${record.file}:${record.id}.`);
  sourceIdsSeen.add(sourceKey);
  if (record.file === paths.expanded) {
    const original = newSources.get(record.id);
    assert(original, `Unknown new annotation ID ${record.id}.`);
    assert.equal(record.sha256, recordHash(original), `Stale source record hash for ${record.id}.`);
    assert.equal(original.review?.status, 'reviewed', `New annotation is not marked reviewed: ${record.id}.`);
    assert.equal(original.review?.type, review.reviewType, `New annotation review type changed: ${record.id}.`);
    if (row.split === 'legacy-test' || row.split === 'legacy-validation') {
      const linked = dataset.items.find(item => item.id === original.linkedExistingId);
      assert(linked && linked.sourceRecord.file !== paths.expanded,
        `New legacy-evaluation meaning requires an explicit old-family link: ${row.id}.`);
      assert.equal(row.groupId, linked.groupId);
      assert.equal(row.split, linked.split);
    }
    for (const field of ['word', 'partOfSpeech', 'definition', 'familyId', 'anchorCategory']) {
      assert.equal(row[field], original[field], `Reviewed new annotation changed ${field}: ${row.id}.`);
    }
    assert.deepEqual(row.labels, original.labels, `Reviewed new labels changed: ${row.id}.`);
    newCount++;
  } else {
    const original = oldSources.get(sourceKey);
    assert(original, `Unknown legacy source record ${record.file}:${record.id}.`);
    assert.equal(record.sha256, recordHash(original.row), `Stale source record hash for ${record.id}.`);
    assert(!quarantineIds.has(record.id), `Quarantined source ${record.id} appears in expanded items.`);
    const expectedSplit = original.row.split === 'validation' ? 'legacy-validation'
      : original.row.split === 'test' ? 'legacy-test' : original.row.split;
    assert.equal(row.originalDatasetSplit, original.row.split, `Original split changed for ${row.id}.`);
    assert.equal(row.split, expectedSplit, `Legacy row moved from its frozen evaluation partition: ${row.id}.`);
    for (const field of ['word', 'partOfSpeech', 'definition', 'familyId', 'primaryClass']) {
      assert.deepEqual(row[field], original.row[field], `Legacy source ${field} changed for ${row.id}.`);
    }
    assert.deepEqual(row.labels, original.row.labels, `Legacy labels changed for ${row.id}.`);
    assert.deepEqual(row.targets, original.row.targets, `Legacy targets changed for ${row.id}.`);
    if (original.row.sourceCaseIds) assert.deepEqual(row.sourceCaseIds, original.row.sourceCaseIds,
      `Legacy source case IDs changed for ${row.id}.`);
    oldCount++;
  }
  if (!rowsBySplit.has(row.split)) rowsBySplit.set(row.split, []);
  rowsBySplit.get(row.split).push(row);
}

const expectedOldRows = base.items.filter(row => row.split !== 'quarantine').length + supplement.items.length;
assert.equal(expectedOldRows, 469, 'Expected 412 active base meanings and 57 supplement meanings.');
assert.equal(oldCount, 469, 'Legacy source row coverage changed.');
assert.equal(newCount, 531, 'New reviewed row coverage changed.');
assert.equal(sourceIdsSeen.size, dataset.items.length, 'Source-record coverage is incomplete.');
for (const row of annotations.items) assert(sourceIdsSeen.has(`${paths.expanded}\0${row.id}`),
  `New annotation missing from expanded dataset: ${row.id}.`);
for (const row of base.items.filter(item => item.split !== 'quarantine')) assert(sourceIdsSeen.has(`${paths.base}\0${row.id}`),
  `Base legacy meaning missing: ${row.id}.`);
for (const row of supplement.items) assert(sourceIdsSeen.has(`${paths.supplement}\0${row.id}`),
  `Supplement meaning missing: ${row.id}.`);
for (const row of baseQuarantine) {
  assert(!sourceIdsSeen.has(`${paths.base}\0${row.id}`), `Quarantined meaning included: ${row.id}.`);
  assert(!dataset.items.some(item => (item.sourceCaseIds || []).some(id => (row.sourceCaseIds || []).includes(id))),
    `Quarantined source cases included from ${row.word}.`);
}

// A connected component is identified by any shared group, normalized lemma,
// or normalized family. All connected members must remain in one split and group.
const identityOwners = new Map();
for (const row of dataset.items) {
  const identities = [
    ['group', normalizeHeadword(row.groupId)],
    ['lemma', normalizeHeadword(row.word)],
    ['family', normalizeHeadword(row.familyId)]
  ];
  for (const [kind, value] of identities) {
    assert(value, `Missing ${kind} identity for ${row.id}.`);
    const key = `${kind}:${value}`;
    const owner = identityOwners.get(key);
    if (owner) {
      assert.equal(owner.split, row.split, `Split leakage for connected ${kind} ${value}.`);
      assert.equal(owner.groupId, row.groupId, `Connected ${kind} ${value} has multiple group IDs.`);
    } else identityOwners.set(key, { split: row.split, groupId: row.groupId });
  }
}
for (const freshSplit of ['validation', 'test']) {
  const fresh = rowsBySplit.get(freshSplit) || [];
  assert(fresh.length > 0, `Fresh ${freshSplit} split is empty.`);
  assert(fresh.every(row => row.sourceRecord.file === paths.expanded),
    `Fresh ${freshSplit} must contain only newly reviewed meanings.`);
  for (const row of fresh) for (const [kind, value] of [
    ['lemma', normalizeHeadword(row.word)], ['family', normalizeHeadword(row.familyId)], ['group', normalizeHeadword(row.groupId)]
  ]) {
    for (const protectedSplit of ['train', 'legacy-validation', 'legacy-test']) {
      for (const other of rowsBySplit.get(protectedSplit) || []) {
        const otherValue = kind === 'lemma' ? normalizeHeadword(other.word)
          : kind === 'family' ? normalizeHeadword(other.familyId) : normalizeHeadword(other.groupId);
        assert.notEqual(value, otherValue,
          `Fresh ${freshSplit} ${kind} ${value} overlaps ${protectedSplit} meaning ${other.word}.`);
      }
    }
  }
}

const trainingCount = counts.train;
assert(trainingCount > 0, 'Expanded training split is empty.');
for (const category of MEANING_CATEGORIES) {
  const positives = trainPositives[category], negatives = trainingCount - positives;
  assert(positives > 0 && negatives > 0, `Training needs both positive and negative ${category} rows.`);
}
const positiveValues = Object.values(trainPositives);
assert(Math.max(...positiveValues) / Math.min(...positiveValues) <= 1.6,
  'Training positive class counts exceed the allowed 1.6 ratio.');
const declaredBalance = dataset.classBalance?.train;
assert(declaredBalance && typeof declaredBalance === 'object', 'Dataset must record classBalance.train.');
for (const category of MEANING_CATEGORIES) {
  const declared = declaredBalance[category];
  const declaredPositive = typeof declared === 'number' ? declared : declared?.positive;
  assert.equal(declaredPositive, trainPositives[category], `Stale training class balance for ${category}.`);
  if (typeof declared === 'object') assert.equal(declared.negative, trainingCount - trainPositives[category],
    `Stale training negative count for ${category}.`);
}

const summary = {
  count: dataset.items.length,
  counts,
  trainPositiveCounts: trainPositives,
  trainPositiveRatio: Math.max(...positiveValues) / Math.min(...positiveValues),
  legacyRows: oldCount,
  newlyReviewedRows: newCount,
  quarantinedSourceIds: declaredQuarantine.length,
  datasetFileSha256: sha256(datasetBytes),
  note: 'Integrity audit only. AI-reviewed meanings are not human-expert ground truth.'
};
console.log(JSON.stringify(summary, null, 2));
