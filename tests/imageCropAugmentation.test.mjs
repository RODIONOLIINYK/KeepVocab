import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { validateDecisions } from '../scripts/encode-image-crops.mjs';
const root = new URL('../', import.meta.url);
const bytes = file => readFile(new URL(file, root));
const hash = value => createHash('sha256').update(value).digest('hex');
const prefix = 'tests/fixtures/image-crops/';

test('crop fixture is review-bound, train-only, and doubles only the accepted parent subset', async () => {
  const [casesBytes, reviewBytes, decisionsBytes, manifestBytes, taxonomyBytes] = await Promise.all([
    bytes('tests/fixtures/image-pretraining-v2/cases.json'), bytes(`${prefix}draft-manifest.json`),
    bytes(`${prefix}review-decisions.json`), bytes(`${prefix}manifest.json`),
    bytes('tests/fixtures/meaning-taxonomy/dataset.json')
  ]);
  const validated = validateDecisions({ casesBytes, reviewBytes, decisionsBytes,
    cropManifest: JSON.parse(reviewBytes), sourceCases: JSON.parse(casesBytes),
    sourceTaxonomy: JSON.parse(taxonomyBytes), taxonomyBytes });
  const manifest = JSON.parse(manifestBytes);
  const encoded = JSON.parse(gunzipSync(await bytes(`${prefix}embeddings.json.gz`)));
  assert.equal(encoded.manifestFileSha256, hash(manifestBytes));
  assert.equal(manifest.source.decisionsFileSha256, hash(decisionsBytes));
  assert.equal(manifest.source.meaningTaxonomySha256, hash(taxonomyBytes));
  assert.equal(validated.decisions.reviewedCount, 385);
  assert.equal(manifest.summary.approvedParentCount, 355);
  assert.equal(manifest.summary.rejectedParentPositiveCount, 30);
  assert.equal(manifest.pairs.length, 710);
  assert.equal(encoded.pairs.length, 710);
  const vectors = new Map(encoded.vectors.map(row => [row.id, row.vector]));
  const meanings = new Map(encoded.meaningVectors.map(row => [row.id, row.vector]));
  assert.equal(meanings.size, 136);
  const groups = new Map();
  for (const pair of manifest.pairs) {
    assert.equal(pair.split, 'train'); assert.equal(pair.label, 1);
    assert.equal(pair.cropReview.status, 'approved');
    assert(pair.approvedCrop.retainedAreaFraction >= .8);
    assert(vectors.has(pair.imageVectorId) && meanings.has(pair.meaningVectorId));
    const key = pair.parentPhotoGroupId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pair);
  }
  assert.equal(groups.size, 355);
  for (const rows of groups.values()) {
    assert.deepEqual(rows.map(row => row.imageVariant).sort(), ['approved-crop', 'original-parent']);
    assert.equal(rows[0].meaningVectorId, rows[1].meaningVectorId);
    assert.deepEqual(rows[0].groupIds, rows[1].groupIds);
    const [original, crop] = rows.map(row => vectors.get(row.imageVectorId));
    const cosine = original.reduce((sum, x, i) => sum + x * crop[i], 0);
    assert(Math.abs(cosine - rows[0].relatedParentCropCosine) < 1e-7);
  }
  for (const vector of [...vectors.values(), ...meanings.values()]) {
    assert.equal(vector.length, 512); assert(vector.every(Number.isFinite));
    assert(Math.abs(Math.hypot(...vector) - 1) < 1e-5);
  }
  const excluded = new Set(manifest.rejectedParentPositivesNeedingReaudit.map(row => row.parentPhoto.sha256));
  assert(manifest.pairs.every(row => !excluded.has(row.parentPhoto.sha256)));
});
