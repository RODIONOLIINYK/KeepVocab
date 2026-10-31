import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { meaningCategoryProbabilities } from '../scripts/lib/meaning-category-classifier.mjs';

const root = new URL('../', import.meta.url);
const manifestPath = 'tests/fixtures/clip-adapter-training/manifest.json';
const vectorsPath = 'tests/fixtures/clip-adapter-training/vectors.json.gz';
const read = async path => readFile(new URL(path, root));
const json = async path => JSON.parse(await read(path));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const close = (actual, expected, tolerance = 1e-10) => assert(Math.abs(actual - expected) <= tolerance,
  `Expected ${actual} to be within ${tolerance} of ${expected}.`);

const [manifestBytes, vectorBytes, casesSource, taxonomySource, cropSource, classifierRegistry] = await Promise.all([
  read(manifestPath), read(vectorsPath), json('tests/fixtures/image-pretraining-v2/cases.json'),
  json('tests/fixtures/meaning-taxonomy/dataset.json'), json('tests/fixtures/image-crops/manifest.json'),
  json('tests/fixtures/meaning-taxonomy/current-classifier.json')
]);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const vectors = JSON.parse(gunzipSync(vectorBytes).toString('utf8'));
const cases = new Map(casesSource.cases.map(row => [row.id, row]));
const classifierPath = manifest.categoryRouting.classifierPath;
const [classifierBytes] = await Promise.all([read(classifierPath)]);
const classifier = JSON.parse(classifierBytes.toString('utf8'));

function assertUnitVector(row, label) {
  assert.equal(row.vector.length, 512, `${label}: output must remove the three legacy scoring fields.`);
  assert(row.vector.every(Number.isFinite), `${label}: vector contains a non-finite value.`);
  const norm = Math.sqrt(row.vector.reduce((sum, value) => sum + value * value, 0));
  close(norm, 1, 1e-5);
}

function selectedAndWrong(caseId, positiveHash, negativeHash, candidateId) {
  const sourceCase = cases.get(caseId);
  assert(sourceCase, `Unknown source gallery ${caseId}.`);
  const selectedIds = sourceCase.feedback?.selected || [];
  const wrongIds = sourceCase.feedback?.wrong || [];
  assert.equal(selectedIds.length, 1, `${caseId}: expected exactly one explicit selected positive.`);
  assert(wrongIds.includes(candidateId), `${caseId}: candidate ${candidateId} is not explicitly labeled wrong.`);
  const positive = sourceCase.candidates.find(candidate => candidate.id === selectedIds[0]);
  const negative = sourceCase.candidates.find(candidate => candidate.id === candidateId);
  assert(positive && negative, `${caseId}: selected or wrong candidate is missing.`);
  assert(/^https?:\/\//.test(positive.url) && /^https?:\/\//.test(negative.url),
    `${caseId}: selected/wrong candidate URL provenance is missing.`);
  assert.equal(positive.sha256, positiveHash, `${caseId}: positive image hash does not match the explicit selection.`);
  assert.equal(negative.sha256, negativeHash, `${caseId}: wrong image hash does not match the explicit negative.`);
  return { sourceCase, positive, negative };
}

test('adapter training package is source-bound, untrained, semantic-only, and leakage-safe', async () => {
  assert.equal(manifest.kind, 'meaning-conditioned-clip-adapter-training-data');
  assert.equal(manifest.targetTask, 'semantic');
  assert.equal(manifest.personalPreference, false);
  assert.equal(manifest.trained, false);
  assert.equal(manifest.summary.userPreferenceExamples, 0);
  assert.equal(manifest.dimension, 512);
  assert.equal(vectors.dimension, 512);
  assert.match(vectors.vectorNormalization, /first 512 values of full-f32 515-value/);
  assert.equal(vectors.kind, 'clip-adapter-vector-store');
  assert.deepEqual(manifest.categories, ['entity', 'place', 'action', 'state', 'relation', 'abstract']);

  assert.equal(manifest.vectorFile, 'vectors.json.gz');
  assert.equal(manifest.vectorFileSha256, sha256(vectorBytes), 'Compressed vector store hash is stale.');
  for (const [path, expected] of Object.entries(manifest.sources)) {
    assert.equal(sha256(await read(path)), expected, `Source file hash changed: ${path}.`);
  }
  assert.equal(manifest.categoryRouting.classifierPath, classifierRegistry.artifact);
  assert.equal(manifest.categoryRouting.classifierSha256, classifierRegistry.artifactFileSha256);
  assert.equal(manifest.categoryRouting.classifierSha256, sha256(classifierBytes));
  const modelBytes = Buffer.from(canonical({
    inputDimension: classifier.inputDimension,
    categories: classifier.categories,
    encoder: classifier.encoder,
    inputProtocol: classifier.inputProtocol,
    modelType: classifier.modelType,
    preprocessor: classifier.preprocessor,
    layers: classifier.layers,
    calibration: classifier.calibration || null
  }));
  assert.equal(manifest.categoryRouting.classifierModelSha256, sha256(modelBytes),
    'Classifier model fingerprint differs from the current registered model.');
  assert.equal(manifest.categoryRouting.sourceMeaningOnly, true);

  const expected = {
    triplets: 2241,
    positivePairs: 954,
    trainTriplets: 1344,
    trainPositivePairs: 710,
    crops: 355
  };
  assert.equal(manifest.triplets.length, expected.triplets);
  assert.equal(manifest.positivePairs.length, expected.positivePairs);
  assert.equal(manifest.summary.tripletComparisonRows, expected.triplets);
  assert.equal(manifest.summary.deduplicatedOriginalPositiveRows, 599);
  assert.equal(manifest.summary.cropPositiveRows, expected.crops);
  assert.equal(manifest.summary.imageVectors, vectors.images.length);
  assert.equal(manifest.summary.meaningVectors, vectors.meanings.length);
  assert.equal(manifest.sourceCounts.taxonomyQuarantinedCaseIds, 15);
  assert.equal(manifest.sourceCounts.cropRejectedParentCaseIds, 30);
  assert.equal(manifest.sourceCounts.excludedCases, 39);
  assert.equal(new Set(manifest.sourceCounts.exclusions.map(row => row.caseId)).size, 39,
    'Exclusion list must contain 39 unique galleries.');
  assert.equal(manifest.sourceCounts.exclusions.length, 39);
  const quarantinedCases = new Set(taxonomySource.items.filter(row => row.split === 'quarantine')
    .flatMap(row => row.sourceCaseIds || []));
  const rejectedCropCases = new Set((cropSource.rejectedParentPositivesNeedingReaudit || []).map(row => row.caseId));
  const exclusions = new Map(manifest.sourceCounts.exclusions.map(row => [row.caseId, row]));
  assert.equal(quarantinedCases.size, 15);
  assert.equal(rejectedCropCases.size, 30);
  const excludedSourceCases = new Set([...quarantinedCases, ...rejectedCropCases]);
  assert.equal(excludedSourceCases.size, 39, 'Quarantine and crop-rejection exclusions must yield 39 unique galleries.');
  for (const id of quarantinedCases) assert.match(exclusions.get(id)?.reason || '', /taxonomy meaning group is quarantined/);
  for (const id of rejectedCropCases) {
    assert.match(exclusions.get(id)?.reason || '', /crop-review rejected|taxonomy meaning group is quarantined/);
  }
  assert.deepEqual(new Set(exclusions.keys()), excludedSourceCases);
  assert.equal(manifest.summary.crossSplitComponentsQuarantined, 0);
  assert.equal(manifest.summary.userPreferenceExamples, 0);
  assert.equal(manifest.personalPreference, false);
  assert.equal(manifest.trained, false);

  const splits = manifest.summary.splitSummary;
  assert.equal(splits.train.triplets, expected.trainTriplets);
  assert.equal(splits.train.positivePairs, expected.trainPositivePairs);
  assert.equal(splits.validation.triplets, 475);
  assert.equal(splits.validation.positivePairs, 133);
  assert.equal(splits.test.triplets, 422);
  assert.equal(splits.test.positivePairs, 111);
  assert.equal(splits.quarantine.records, 0);
  assert.match(manifest.sourceSplitPolicy, /preserve original image train\/validation\/test splits/);
  assert(!Object.hasOwn(manifest, 'accuracy') && !Object.hasOwn(manifest, 'evaluationResults'),
    'Prepared data must not claim held-out accuracy or model evaluation.');
  assert(manifest.triplets.every(row => row.split === row.sourceSplit));
  assert(manifest.positivePairs.every(row => row.split === row.sourceSplit));
  assert(manifest.positivePairs.filter(row => row.imageVariant === 'approved-crop')
    .every(row => row.split === 'train' && row.sourceSplit === 'train'));

  // Component and individual group IDs may never bridge different partitions.
  const splitForGroup = new Map(), splitForComponent = new Map(), splitForPhoto = new Map();
  for (const record of [...manifest.triplets, ...manifest.positivePairs]) {
    assert.equal(record.componentSourceSplits.length, 1, `${record.id}: component crossed source splits.`);
    assert.equal(record.componentSourceSplits[0], record.sourceSplit, `${record.id}: component split metadata is stale.`);
    assert.equal(record.split, record.sourceSplit, `${record.id}: unexpected non-retired split reassignment.`);
    const priorComponent = splitForComponent.get(record.componentId);
    assert(!priorComponent || priorComponent === record.split, `${record.id}: component leakage across splits.`);
    splitForComponent.set(record.componentId, record.split);
    for (const group of record.groupIds) {
      const prior = splitForGroup.get(group);
      assert(!prior || prior === record.split, `${record.id}: group ${group} leaks across splits.`);
      splitForGroup.set(group, record.split);
    }
    const hashes = record.id.startsWith('triplet:')
      ? [record.positiveImageSha256, record.negativeImageSha256] : [record.imageSha256];
    for (const hash of hashes) {
      const prior = splitForPhoto.get(hash);
      assert(!prior || prior === record.split, `${record.id}: photo ${hash} leaks across splits.`);
      splitForPhoto.set(hash, record.split);
    }
  }
  assert.equal(splitForComponent.size, manifest.componentSummary.length);
  assert(manifest.componentSummary.every(component => component.sourceSplits.length === 1
    && component.split === component.sourceSplits[0]));

  // Full precision source records used 515 coordinates; every stored vector is
  // the normalized 512-coordinate CLIP representation only.
  const imageVectors = new Map(vectors.images.map(row => [row.id, row]));
  const meaningVectors = new Map(vectors.meanings.map(row => [row.id, row]));
  assert.equal(imageVectors.size, vectors.images.length);
  assert.equal(meaningVectors.size, vectors.meanings.length);
  for (const row of vectors.images) assertUnitVector(row, row.id);
  for (const row of vectors.meanings) assertUnitVector(row, row.id);

  const references = [...manifest.triplets, ...manifest.positivePairs];
  for (const record of references) {
    assert(meaningVectors.has(record.meaningVectorId), `${record.id}: missing meaning vector.`);
    if (record.id.startsWith('triplet:')) {
      assert(imageVectors.has(record.positiveImageVectorId), `${record.id}: missing positive image vector.`);
      assert(imageVectors.has(record.negativeImageVectorId), `${record.id}: missing wrong image vector.`);
      assert.equal(imageVectors.get(record.positiveImageVectorId).assetSha256, record.positiveImageSha256);
      assert.equal(imageVectors.get(record.negativeImageVectorId).assetSha256, record.negativeImageSha256);
    } else {
      assert(imageVectors.has(record.imageVectorId), `${record.id}: missing image vector.`);
      assert.equal(imageVectors.get(record.imageVectorId).assetSha256, record.imageSha256);
    }
  }

  // Recompute the six independent outputs from each stored meaning vector with
  // the registered portable classifier, then compare all routed records.
  const probabilitiesByMeaning = new Map();
  for (const [id, row] of meaningVectors) {
    const probabilities = meaningCategoryProbabilities(classifier, row.vector);
    assert.equal(probabilities.length, 6);
    assert(probabilities.every(value => value >= 0 && value <= 1 && Number.isFinite(value)));
    probabilitiesByMeaning.set(id, probabilities);
  }
  assert.equal(probabilitiesByMeaning.size, 229);
  for (const record of references) {
    const probabilities = probabilitiesByMeaning.get(record.meaningVectorId);
    assert(probabilities, `${record.id}: missing classifier output for target meaning.`);
    probabilities.forEach((value, index) => close(record.categoryProbabilities[index], value, 1e-12));
    const total = probabilities.reduce((sum, value) => sum + value, 0);
    assert(total > 0, `${record.id}: unexpected zero-sum router vector.`);
    record.routerWeights.forEach((weight, index) => close(weight, probabilities[index] / total, 1e-12));
    close(record.routerWeights.reduce((sum, value) => sum + value, 0), 1, 1e-12);
  }
  assert(vectors.images.every(row => !Object.hasOwn(row, 'categoryProbabilities')),
    'Category probabilities must route by target meaning, not image-side classifier inference.');

  // Check each contrast against the source gallery's explicit selected and
  // wrong candidate IDs, hashes, and meanings.
  const tripletsByCase = new Map();
  for (const row of manifest.triplets) {
    const candidateId = row.id.slice(row.id.lastIndexOf(':') + 1);
    const { sourceCase, positive } = selectedAndWrong(row.caseId,
      row.positiveImageSha256, row.negativeImageSha256, candidateId);
    assert.equal(row.meaningId, sourceCase.meaningId);
    assert.equal(row.word, sourceCase.word.word);
    assert.equal(row.familyId, sourceCase.familyId);
    assert.equal(row.sourceSplit, sourceCase.split);
    assert(positive.sha256);
    if (!tripletsByCase.has(row.caseId)) tripletsByCase.set(row.caseId, []);
    tripletsByCase.get(row.caseId).push(row);
  }
  for (const [caseId, rows] of tripletsByCase) {
    close(rows.reduce((sum, row) => sum + row.comparisonWeight, 0), 1, 1e-12);
    const sourceCase = cases.get(caseId);
    assert.equal(rows.length, sourceCase.feedback.wrong.length, `${caseId}: not all explicit wrong candidates were retained.`);
  }

  const positiveOriginals = manifest.positivePairs.filter(row => row.imageVariant !== 'approved-crop');
  const cropPairs = manifest.positivePairs.filter(row => row.imageVariant === 'approved-crop');
  assert.equal(positiveOriginals.length, 599);
  assert.equal(cropPairs.length, expected.crops);
  const approvedCropSources = new Map(cropSource.pairs.filter(row => row.imageVariant === 'approved-crop').map(row => [row.id, row]));
  assert.equal(approvedCropSources.size, expected.crops);
  assert.equal(cropSource.pairs.length, 710);
  const cropsByParent = new Map();
  for (const crop of cropPairs) {
    assert.equal(crop.split, 'train');
    assert.equal(crop.sourceSplit, 'train');
    assert.equal(crop.pointPairWeight, 0.5);
    assert.equal(crop.imageVariant, 'approved-crop');
    assert.equal(crop.reviewStatus, 'AI visual review; not human-expert ground truth');
    assert(crop.parentImageSha256);
    assert.equal(crop.reviewRefs.length, 1);
    const sourceCrop = approvedCropSources.get(crop.reviewRefs[0]);
    assert(sourceCrop, `${crop.id}: missing approved crop review source.`);
    assert.equal(sourceCrop.cropReview.status, 'approved');
    assert.equal(sourceCrop.label, 1);
    assert.equal(sourceCrop.split, 'train');
    assert.equal(sourceCrop.isIndependentPhoto, false);
    assert.equal(sourceCrop.approvedCrop.sha256, crop.imageSha256);
    assert.equal(sourceCrop.parentPhoto.sha256, crop.parentImageSha256);
    assert.equal(sourceCrop.meaningId, crop.meaningId);
    assert.equal(sourceCrop.familyId, crop.familyId);
    const key = `${crop.parentImageSha256}|${crop.meaningVectorId}`;
    assert(!cropsByParent.has(key), `More than one crop for parent ${key}.`);
    cropsByParent.set(key, crop);
  }
  const pairWeightByParent = new Map();
  for (const original of positiveOriginals) {
    const crop = cropsByParent.get(`${original.imageSha256}|${original.meaningVectorId}`);
    if (crop) {
      assert.equal(original.split, 'train');
      assert.equal(original.pointPairWeight, 0.5);
      assert.equal(crop.parentImageSha256, original.imageSha256);
      assert.equal(crop.meaningVectorId, original.meaningVectorId);
      pairWeightByParent.set(`${original.imageSha256}|${original.meaningVectorId}`,
        original.pointPairWeight + crop.pointPairWeight);
      cropsByParent.delete(`${original.imageSha256}|${original.meaningVectorId}`);
    } else {
      assert.equal(original.pointPairWeight, 1, `${original.id}: uncropped positive should keep full point weight.`);
    }
  }
  assert.equal(cropsByParent.size, 0, 'Every approved crop must have its accepted original parent pair.');
  assert.equal(pairWeightByParent.size, expected.crops);
  assert([...pairWeightByParent.values()].every(weight => weight === 1));

  // The source explicitly allows a hash-identical photo to be positive for one
  // meaning and wrong for another; these roles are not globally contradictory.
  const positiveHashes = new Set(manifest.triplets.map(row => row.positiveImageSha256));
  const negativeHashes = new Set(manifest.triplets.map(row => row.negativeImageSha256));
  assert(positiveHashes.size > 0 && negativeHashes.size > 0);
  assert([...positiveHashes].some(hash => negativeHashes.has(hash)));
});

test('adapter data converter requires an explicit classifier selection', () => {
  const result = spawnSync(process.execPath, [new URL('../scripts/prepare-clip-adapter-data.mjs', import.meta.url).pathname], {
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicitly selected classifier is required/);
});
