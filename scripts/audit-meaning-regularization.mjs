import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEANING_CATEGORIES, normalizeHeadword, sha256 } from './lib/meaning-taxonomy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = 'tests/fixtures/meaning-taxonomy/regularized-expansion';
const paths = {
  base: 'tests/fixtures/meaning-taxonomy/expanded-1000/dataset.json',
  annotations: `${directory}/new-annotations.json`
};
const bytes = async path => readFile(resolve(root, path));
const parse = value => JSON.parse(value.toString('utf8'));
const recordHash = row => sha256(JSON.stringify(row));
const normalizeDefinition = value => String(value).normalize('NFKD').toLowerCase()
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const [datasetBytes, annotationBytes, reviewBytes, baseBytes] = await Promise.all([
  bytes(`${directory}/dataset.json`), bytes(paths.annotations),
  bytes(`${directory}/review.json`), bytes(paths.base)
]);
const dataset = parse(datasetBytes), annotationsFile = parse(annotationBytes);
const review = parse(reviewBytes), base = parse(baseBytes);
const annotations = Array.isArray(annotationsFile) ? annotationsFile : annotationsFile.items;
assert(Array.isArray(dataset.items) && Array.isArray(annotations), 'Dataset and annotations must contain item arrays.');

assert.equal(dataset.task, 'meaning-category-membership');
assert.deepEqual(dataset.categories, MEANING_CATEGORIES);
assert.equal(dataset.targetEncoding, 'multilabel-binary-in-category-order');
assert.equal(dataset.items.length, 1420, 'Regularized expansion must contain exactly 1,420 meanings.');
assert.equal(review.reviewType, 'AI semantic review; not human-expert ground truth');
assert.equal(review.reviewedCount, 420, 'Exactly 420 new meanings require primary review.');
assert.equal(annotations.length, 420, 'New annotation count changed.');
assert.equal(review.newAnnotationsFileSha256, sha256(annotationBytes), 'New annotation source changed after review.');
if (review.datasetFileSha256 !== undefined) {
  assert.equal(review.datasetFileSha256, sha256(datasetBytes), 'Regularized dataset review hash changed.');
}

const expectedSources = { [paths.base]: baseBytes, [paths.annotations]: annotationBytes };
assert(dataset.sourceFilesSha256 && typeof dataset.sourceFilesSha256 === 'object',
  'Dataset must record source file hashes.');
for (const [path, sourceBytes] of Object.entries(expectedSources)) {
  assert.equal(dataset.sourceFilesSha256[path], sha256(sourceBytes), `Source file hash changed: ${path}.`);
}
for (const [path, expectedHash] of Object.entries(dataset.sourceFilesSha256)) {
  assert.equal(expectedHash, sha256(await bytes(path)), `Unknown or stale source file hash: ${path}.`);
}

const oldRows = base.items;
assert.equal(oldRows.length, 1000, 'The frozen expanded source must contain 1,000 rows.');
const oldById = new Map(oldRows.map(row => [row.id, row]));
assert.equal(oldById.size, oldRows.length, 'Duplicate IDs in the frozen expanded source.');
const annotationById = new Map(annotations.map(row => [row.id, row]));
assert.equal(annotationById.size, annotations.length, 'Duplicate annotation IDs.');
const oldSourcePath = paths.base;
const annotationSourcePath = paths.annotations;
const ids = new Set(), sourceIds = new Set(), meaningKeys = new Set();
const rowsBySplit = new Map();
const regularizedOldById = new Map();
const rawPositive = Object.fromEntries(MEANING_CATEGORIES.map(label => [label, 0]));
const trainWeightedPositive = Object.fromEntries(MEANING_CATEGORIES.map(label => [label, 0]));
const trainWeightsByUnit = new Map();
let oldCount = 0, newMeaningCount = 0, paraphraseCount = 0;
const newHeadwords = new Set();
const oldHeadwords = new Set(oldRows.map(row => normalizeHeadword(row.word)));

for (const row of dataset.items) {
  assert(row.id && !ids.has(row.id), `Missing or duplicate dataset ID ${row.id}.`); ids.add(row.id);
  assert(row.word?.trim() && row.partOfSpeech?.trim() && row.definition?.trim() && row.familyId?.trim(),
    `Missing meaning fields for ${row.id}.`);
  const head = normalizeHeadword(row.word);
  const meaningKey = JSON.stringify([head, normalizeHeadword(row.partOfSpeech), row.definition.trim()]);
  assert(!meaningKeys.has(meaningKey), `Duplicate exact meaning ${row.word}.`); meaningKeys.add(meaningKey);
  assert(Array.isArray(row.labels) && row.labels.length > 0, `Missing labels for ${row.id}.`);
  assert.deepEqual(row.labels, MEANING_CATEGORIES.filter(label => row.labels.includes(label)),
    `Labels must be unique and in category order for ${row.id}.`);
  assert.deepEqual(row.targets, MEANING_CATEGORIES.map(label => Number(row.labels.includes(label))),
    `Targets do not encode label membership for ${row.id}.`);
  assert(row.anchorCategory && row.labels.includes(row.anchorCategory), `Invalid anchor category for ${row.id}.`);
  assert(row.groupId?.trim(), `Missing group ID for ${row.id}.`);
  const split = row.split;
  assert(['train', 'validation', 'test', 'legacy-validation', 'legacy-test'].includes(split),
    `Invalid regularized split for ${row.id}.`);
  if (!rowsBySplit.has(split)) rowsBySplit.set(split, []);
  rowsBySplit.get(split).push(row);
  const source = row.sourceRecord;
  assert(source && typeof source.file === 'string' && typeof source.id === 'string'
    && typeof source.sha256 === 'string', `Missing source provenance for ${row.id}.`);
  const sourceKey = `${source.file}\0${source.id}`;
  assert(!sourceIds.has(sourceKey), `Duplicate source record ${source.file}:${source.id}.`);
  sourceIds.add(sourceKey);

  if (source.file === oldSourcePath) {
    const original = oldById.get(source.id);
    assert(original, `Unknown old source ID ${source.id}.`);
    assert.equal(source.sha256, recordHash(original), `Stale old source hash for ${source.id}.`);
    for (const field of ['id', 'word', 'partOfSpeech', 'definition', 'labels', 'targets', 'anchorCategory']) {
      assert.deepEqual(row[field], original[field], `Frozen source field ${field} changed for ${row.id}.`);
    }
    const expectedSplit = original.split === 'validation' ? 'legacy-validation'
      : original.split === 'test' ? 'legacy-test'
        : original.split === 'legacy-validation' || original.split === 'legacy-test' ? original.split : 'train';
    assert.equal(split, expectedSplit, `Old source split changed for ${row.id}.`);
    assert.equal(row.originalSplit, original.originalSplit, `Original split metadata changed for ${row.id}.`);
    assert.equal(row.kind, undefined, `Old meaning incorrectly marked as newly authored: ${row.id}.`);
    assert.equal(row.meaningUnitId, row.id, `Old meaning unit ID changed for ${row.id}.`);
    if (split !== 'train') assert.equal(row.sampleWeight, 1, `Evaluation meaning must have unit sample weight: ${row.id}.`);
    regularizedOldById.set(original.id, row);
    oldCount++;
  } else {
    assert.equal(source.file, annotationSourcePath, `Unknown source file for ${row.id}.`);
    const annotation = annotationById.get(source.id);
    assert(annotation, `Unknown annotation ID ${source.id}.`);
    assert.equal(source.sha256, recordHash(annotation), `Stale annotation hash for ${source.id}.`);
    for (const field of ['word', 'partOfSpeech', 'definition', 'familyId', 'anchorCategory', 'labels']) {
      assert.deepEqual(row[field], annotation[field], `Reviewed annotation field ${field} changed: ${row.id}.`);
    }
    assert.equal(annotation.review?.status, 'reviewed', `Annotation was not reviewed: ${source.id}.`);
    assert.equal(annotation.review?.type, review.reviewType, `Annotation review type changed: ${source.id}.`);
    const kind = annotation.kind ?? row.kind;
    assert(['new-meaning', 'paraphrase'].includes(kind), `Invalid new meaning kind for ${row.id}.`);
    assert.equal(row.kind, kind, `Meaning kind differs from source annotation for ${row.id}.`);
    if (kind === 'new-meaning') {
      assert(!oldHeadwords.has(head), `New headword overlaps old dataset: ${row.word}.`);
      assert(!newHeadwords.has(head), `New headword is repeated: ${row.word}.`);
      newHeadwords.add(head);
      assert.equal(row.meaningUnitId, row.id, `New meaning must form its own meaning unit: ${row.id}.`);
      newMeaningCount++;
    } else {
      const parentId = annotation.sourceId ?? row.sourceId;
      const parent = oldById.get(parentId);
      assert(parent && parent.split === 'train', `Paraphrase must link to an old training meaning: ${row.id}.`);
      assert.equal(row.word, parent.word, `Paraphrase headword changed: ${row.id}.`);
      assert.equal(row.partOfSpeech, parent.partOfSpeech, `Paraphrase part of speech changed: ${row.id}.`);
      assert.deepEqual(row.labels, parent.labels, `Paraphrase labels differ from parent: ${row.id}.`);
      assert.notEqual(normalizeDefinition(row.definition), normalizeDefinition(parent.definition),
        `Paraphrase definition differs only in punctuation or spacing: ${row.id}.`);
      assert.equal(normalizeHeadword(row.sourceGroupId), normalizeHeadword(parent.groupId),
        `Paraphrase source group differs from parent: ${row.id}.`);
      assert.equal(row.meaningUnitId, parent.id, `Paraphrase meaning unit must point to its parent: ${row.id}.`);
      assert.equal(row.split, 'train', `Paraphrases must stay in training: ${row.id}.`);
      paraphraseCount++;
    }
    const sourceId = kind === 'paraphrase' ? (annotation.sourceId ?? row.sourceId) : source.id;
    const parent = kind === 'paraphrase' ? oldById.get(sourceId) : null;
    const expectedUnit = parent?.id ?? row.id;
    assert.equal(row.meaningUnitId, expectedUnit, `Wrong meaning unit for ${row.id}.`);
    assert(row.definition.trim().length > 0 && !/\b(?:entity|place|action|state|relation|abstract)\s+(?:meaning|category|label)\b/i.test(row.definition),
      `Definition contains category metatext: ${row.id}.`);
  }

  const unit = row.meaningUnitId;
  assert(unit?.trim(), `Missing meaningUnitId for ${row.id}.`);
  const weight = row.sampleWeight;
  assert(Number.isFinite(weight) && weight > 0, `Invalid sampleWeight for ${row.id}.`);
  for (const label of row.labels) rawPositive[label]++;
  if (split === 'train') {
    for (const label of row.labels) trainWeightedPositive[label] += weight;
    trainWeightsByUnit.set(unit, (trainWeightsByUnit.get(unit) || 0) + weight);
  }
}

assert.equal(oldCount, 1000, 'All old source rows must be preserved exactly once.');
assert.equal(newMeaningCount, 280, 'Exactly 280 fresh meanings are required.');
assert.equal(paraphraseCount, 140, 'Exactly 140 paraphrases are required.');
assert.equal(oldCount + newMeaningCount + paraphraseCount, dataset.items.length);
assert.equal(sourceIds.size, dataset.items.length, 'Source-record coverage is incomplete.');
for (const annotation of annotations) {
  assert(sourceIds.has(`${annotationSourcePath}\0${annotation.id}`), `Missing annotation ${annotation.id}.`);
}
for (const old of oldRows) assert(sourceIds.has(`${oldSourcePath}\0${old.id}`), `Missing old meaning ${old.id}.`);
assert.equal([...rowsBySplit.values()].flat().filter(row => row.sourceRecord.file === oldSourcePath && row.split === 'train').length,
  590, 'All 590 old training rows must remain in train.');
for (const split of ['validation', 'test']) {
  const fresh = rowsBySplit.get(split) || [];
  assert.equal(fresh.length, 48, `Fresh ${split} must contain exactly 48 meanings.`);
  assert(fresh.every(row => row.kind === 'new-meaning' && row.sourceRecord.file === annotationSourcePath
    && !row.relatedExistingId),
    `Fresh ${split} must contain only new meanings.`);
  for (const category of MEANING_CATEGORIES) {
    assert.equal(fresh.filter(row => row.anchorCategory === category).length, 8,
      `Fresh ${split} must contain 8 ${category} anchors.`);
  }
}

// Every connected identity must have one split and one recomputed dataset group.
const owners = new Map();
const addIdentity = (kind, value, row) => {
  const normalized = normalizeHeadword(value);
  assert(normalized, `Empty ${kind} identity for ${row.id}.`);
  const key = `${kind}:${normalized}`;
  const previous = owners.get(key);
  if (previous) {
    assert.equal(previous.split, row.split, `Split leakage for ${kind} ${normalized}.`);
    assert.equal(previous.groupId, row.groupId, `Connected ${kind} ${normalized} has multiple groups.`);
  } else owners.set(key, { split: row.split, groupId: row.groupId });
};
for (const row of dataset.items) {
  for (const key of ['extraFamilyKeys']) assert(Array.isArray(row[key] ?? []), `Invalid ${key} for ${row.id}.`);
  for (const [kind, value] of [
    ['group', row.groupId], ['meaning-family', row.word], ['meaning-family', row.familyId],
    ...(row.extraFamilyKeys || []).map(value => ['meaning-family', value]),
    ...(row.sourceGroupId ? [['source-group', row.sourceGroupId]] : [])
  ]) addIdentity(kind, value, row);
  const relatedExistingId = row.relatedExistingId ?? annotationById.get(row.sourceRecord.id)?.relatedExistingId;
  if (relatedExistingId) {
    const related = oldById.get(relatedExistingId);
    assert(related, `relatedExistingId must reference an old meaning: ${row.id}.`);
    const expectedRelatedSplit = related.split === 'validation' ? 'legacy-validation'
      : related.split === 'test' ? 'legacy-test'
        : related.split === 'legacy-validation' || related.split === 'legacy-test' ? related.split : 'train';
    assert.equal(row.split, expectedRelatedSplit,
      `Related meaning must inherit its linked old partition: ${row.id}.`);
    assert.equal(row.groupId, regularizedOldById.get(relatedExistingId)?.groupId,
      `Related existing meaning must share the recomputed group: ${row.id}.`);
  }
}

for (const [unit, totalWeight] of trainWeightsByUnit) {
  assert(Math.abs(totalWeight - 1) <= 1e-8, `Meaning unit ${unit} has total training weight ${totalWeight}, expected 1.`);
}
assert.equal(trainWeightsByUnit.size, 590 + (rowsBySplit.get('train') || []).filter(row => row.kind === 'new-meaning').length,
  'Training meaning units must include each old meaning and each fresh training meaning exactly once.');

const rawCounts = Object.fromEntries(MEANING_CATEGORIES.map(label => [label, { positive: rawPositive[label], negative: dataset.items.length - rawPositive[label] }]));
const trainCounts = Object.fromEntries(MEANING_CATEGORIES.map(label => [label, {
  positive: trainWeightedPositive[label],
  negative: (rowsBySplit.get('train') || []).reduce((sum, row) => sum + (row.labels.includes(label) ? 0 : row.sampleWeight), 0)
}]));
for (const [name, counts] of [['raw', rawCounts], ['trainWeighted', trainCounts]]) {
  const positives = Object.values(counts).map(value => value.positive);
  assert(positives.every(value => value > 0), `${name} class balance has a class with no positives.`);
  assert(Math.max(...positives) / Math.min(...positives) <= 2,
    `${name} positive class balance exceeds the allowed 2.0 ratio.`);
}
const declared = dataset.classBalance;
assert(declared && declared.raw && declared.trainWeighted, 'Dataset must record raw and trainWeighted classBalance.');
for (const [name, expected] of [['raw', rawCounts], ['trainWeighted', trainCounts]]) {
  for (const category of MEANING_CATEGORIES) {
    const entry = declared[name][category];
    const positive = typeof entry === 'number' ? entry : entry?.positive;
    assert.equal(positive, expected[category].positive, `Stale ${name} positive balance for ${category}.`);
    if (typeof entry === 'object') assert.equal(entry.negative, expected[category].negative,
      `Stale ${name} negative balance for ${category}.`);
  }
}

const counts = Object.fromEntries([...rowsBySplit].map(([split, rows]) => [split, rows.length]));
const summary = {
  count: dataset.items.length, counts, newMeaningCount, paraphraseCount,
  rawClassBalance: rawCounts, trainWeightedClassBalance: trainCounts,
  maximumClassBalanceRatio: 2,
  datasetFileSha256: sha256(datasetBytes),
  note: 'Integrity audit only. AI-reviewed meanings are not human-expert ground truth.'
};
console.log(JSON.stringify(summary, null, 2));
