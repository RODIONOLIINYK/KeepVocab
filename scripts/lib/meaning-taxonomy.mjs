// Offline dataset integrity utilities. No app model is trained or activated here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const MEANING_CATEGORIES = Object.freeze(['entity', 'place', 'action', 'state', 'relation', 'abstract']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalizeHeadword = value => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
export const meaningKey = row => JSON.stringify([normalizeHeadword(row.word), normalizeHeadword(row.partOfSpeech), row.definition]);
export const reviewContentHash = rows => sha256(JSON.stringify(rows));

export function applyReviewedDecisions(legacyRows, authoredRows, decisions) {
  const rows = [
    ...legacyRows.map((row, index) => ({ ...row, sourceKind: 'legacy', sourceIndex: index })),
    ...authoredRows.map((row, index) => ({ ...row, sourceKind: 'authored', sourceIndex: index }))
  ];
  for (const row of rows) assert(Array.isArray(row.labels)
    && row.labels.every(category => MEANING_CATEGORIES.includes(category)),
  `Unknown/missing draft categories at ${row.sourceKind}:${row.sourceIndex}.`);
  const seen = new Set();
  for (const change of decisions.overrides || []) {
    const key = `${change.sourceKind}:${change.sourceIndex}`;
    assert(!seen.has(key), `Duplicate review decision ${key}.`); seen.add(key);
    const row = rows.find(item => item.sourceKind === change.sourceKind && item.sourceIndex === change.sourceIndex);
    assert(row && change.reason?.trim(), `Invalid review decision ${key}.`);
    Object.assign(row, change.fields);
    assert(Array.isArray(row.labels) && row.labels.every(category => MEANING_CATEGORIES.includes(category)),
      `Unknown review categories at ${key}.`);
  }
  // Project only the fields actually inspected. Unknown draft fields are not
  // training features, and no draft contrast is an actual negative image label.
  return rows.map(row => ({
    sourceKind: row.sourceKind, sourceIndex: row.sourceIndex,
    word: row.word, partOfSpeech: row.partOfSpeech, definition: row.definition,
    familyId: row.familyId, ...(row.split ? { originalSplit: row.split } : {}),
    labels: MEANING_CATEGORIES.filter(category => row.labels.includes(category)),
    primaryClass: row.primaryClass, requiredEvidence: row.requiredEvidence,
    rationale: row.rationale, confidence: row.confidence,
    ...(row.evidenceLimitations ? { evidenceLimitations: row.evidenceLimitations } : {})
  }));
}

export function assertReviewedContent(rows, decisions) {
  assert.equal(rows.length, decisions.reviewedCount, 'Reviewed row count changed; review new content first.');
  assert.equal(reviewContentHash(rows), decisions.reviewedContentSha256,
    'Reviewed annotation content changed; labels/evidence require another review.');
  assert.equal(decisions.reviewType, 'AI semantic review; not human-expert ground truth');
}

export function assignMeaningPartitions(rows) {
  const owners = new Map(), parents = rows.map((_, index) => index);
  const root = index => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const join = (a, b) => { parents[root(b)] = root(a); };
  rows.forEach((row, index) => {
    for (const identity of [`lemma:${normalizeHeadword(row.word)}`, `family:${normalizeHeadword(row.familyId)}`]) {
      if (owners.has(identity)) join(index, owners.get(identity)); else owners.set(identity, index);
    }
  });
  const components = new Map();
  rows.forEach((row, index) => {
    const key = root(index); if (!components.has(key)) components.set(key, []);
    components.get(key).push(row);
  });
  const assigned = new Map();
  for (const members of components.values()) {
    const groupId = `family-${sha256(members.map(meaningKey).sort().join('\n')).slice(0, 16)}`;
    const oldSplits = [...new Set(members.map(row => row.originalSplit).filter(Boolean))].sort();
    // A connected component already exposed in several legacy splits is
    // quarantined, not silently moved into train or called an untouched test.
    let split;
    if (oldSplits.length > 1) split = 'quarantine';
    else if (oldSplits.length) [split] = oldSplits;
    else {
      const bucket = parseInt(sha256(`meaning-taxonomy-v1:${groupId}`).slice(0, 8), 16) % 10;
      split = bucket < 6 ? 'train' : bucket < 8 ? 'validation' : 'test';
    }
    for (const row of members) assigned.set(meaningKey(row), {
      groupId, split, ...(oldSplits.length > 1 ? { quarantineReason: `Legacy component crosses ${oldSplits.join(', ')}.` } : {})
    });
  }
  return rows.map(row => ({ ...row, ...assigned.get(meaningKey(row)) }));
}

export function annotationHash(row) {
  const { review, ...annotation } = row;
  return sha256(JSON.stringify(annotation));
}

export function auditMeaningTaxonomy(dataset, review, cases) {
  assert.deepEqual(dataset.categories, MEANING_CATEGORIES);
  assert.equal(dataset.task, 'meaning-category-membership');
  assert.equal(dataset.targetEncoding, 'multilabel-binary-in-category-order');
  assert.equal(dataset.trained, false); assert.equal(dataset.personalPreference, false);
  const unique = new Set(), ids = new Set(), groups = new Map(), lemmas = new Map(), families = new Map();
  const expectedLegacy = new Map();
  for (const item of cases.cases) {
    const row = { word: item.word.word, partOfSpeech: item.word.partOfSpeech, definition: item.word.definition };
    const key = meaningKey(row);
    if (!expectedLegacy.has(key)) expectedLegacy.set(key, { splits: new Set(), families: new Set(), ids: [] });
    const info = expectedLegacy.get(key); info.splits.add(item.split); info.families.add(item.familyId); info.ids.push(item.id);
  }
  const counts = {}, positives = {}, seenLegacy = new Set();
  for (const split of ['train', 'validation', 'test', 'quarantine']) {
    counts[split] = 0;
    positives[split] = Object.fromEntries(MEANING_CATEGORIES.map(category => [category, 0]));
  }
  for (const row of dataset.items) {
    const key = meaningKey(row);
    assert(row.id && !ids.has(row.id), `Repeated/missing ID ${row.id}.`); ids.add(row.id);
    assert(!unique.has(key), `Duplicate exact meaning ${row.word}.`); unique.add(key);
    assert(row.word?.trim() && row.definition?.trim() && row.familyId?.trim(), `Missing meaning fields ${row.id}.`);
    assert(row.labels.length && row.labels.length === new Set(row.labels).size, `Missing/duplicate labels ${row.id}.`);
    assert(row.labels.every(label => MEANING_CATEGORIES.includes(label)), `Unknown category ${row.id}.`);
    assert(row.labels.includes(row.primaryClass), `Primary class absent from labels ${row.id}.`);
    assert.deepEqual(row.targets, MEANING_CATEGORIES.map(category => Number(row.labels.includes(category))));
    assert(row.requiredEvidence?.trim() && row.rationale?.trim(), `Missing evidence/rationale ${row.id}.`);
    assert(['high', 'medium', 'low'].includes(row.confidence), `Missing review confidence ${row.id}.`);
    assert.equal(row.review.annotationSha256, annotationHash(row), `Stale annotation review ${row.id}.`);
    assert.equal(row.review.status, 'reviewed');
    assert.equal(row.review.type, 'AI semantic review; not human-expert ground truth');
    assert(Object.hasOwn(counts, row.split), `Invalid split ${row.id}.`); counts[row.split]++;
    for (const label of row.labels) positives[row.split][label]++;
    for (const [map, identity] of [[groups, row.groupId], [lemmas, normalizeHeadword(row.word)], [families, normalizeHeadword(row.familyId)]]) {
      assert(!map.has(identity) || map.get(identity) === row.split, `Meaning-family leakage at ${identity}.`);
      map.set(identity, row.split);
    }
    if (row.sourceKind === 'legacy') {
      const original = expectedLegacy.get(key); assert(original, `Legacy meaning was changed ${row.id}.`);
      assert(original.splits.has(row.originalSplit)); assert(original.families.has(row.familyId));
      assert.deepEqual([...row.sourceCaseIds].sort(), [...original.ids].sort()); seenLegacy.add(key);
      if (row.split !== 'quarantine') assert.equal(row.split, row.originalSplit, `Legacy split reassigned ${row.id}.`);
    } else assert.equal(row.sourceKind, 'authored');
  }
  assert.deepEqual([...seenLegacy].sort(), [...expectedLegacy.keys()].sort(), 'Legacy meaning coverage is incomplete.');
  for (const split of ['train', 'validation', 'test']) for (const category of MEANING_CATEGORIES) {
    assert(positives[split][category] > 0, `${split} has no positive ${category} examples.`);
    assert(positives[split][category] < counts[split], `${split} has no negative ${category} examples.`);
  }
  assert.equal(review.datasetSha256, sha256(JSON.stringify(dataset)), 'Dataset review hash changed.');
  assert.equal(review.reviewedCount, dataset.items.length);
  const summary = { count: dataset.items.length, counts, positives,
    multilabelRows: dataset.items.filter(row => row.labels.length > 1).length,
    quarantined: dataset.items.filter(row => row.split === 'quarantine').map(row => ({ id: row.id, word: row.word, originalSplit: row.originalSplit, reason: row.quarantineReason })),
    note: 'Integrity audit only. AI labels are a reviewed pilot, not human-expert truth or image-quality evidence.' };
  // Null is used only while preparing a new report; persisted reports must
  // carry the exact summary rather than silently display stale support counts.
  if (review.audit !== null) assert.deepEqual(review.audit, summary, 'Stored audit summary is stale.');
  return summary;
}
