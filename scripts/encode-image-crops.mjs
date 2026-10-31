#!/usr/bin/env node
/** Encode only reviewed, approved training crops as positive semantic pairs.
 *
 * Run after an AI reviewer writes tests/fixtures/image-crops/review-decisions.json:
 *   node scripts/encode-image-crops.mjs
 *
 * The draft review manifest is read-only. This script never downloads photos or
 * models, invents labels, augments held-out splits, or treats crops as new photos.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { imageEvaluationRuntime } from './image-evaluation-runtime.mjs';
import { CLIP_DIMENSION, CLIP_TAG } from '../js/ml/clipConfig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CROP_DIRECTORY = resolve(ROOT, 'work/image-crop-augmentation');
const PARENT_DIRECTORY = resolve(ROOT, 'work/mlp-fp16-retrain/photos');
const CASES_PATH = resolve(ROOT, 'tests/fixtures/image-pretraining-v2/cases.json');
const REVIEW_PATH = resolve(CROP_DIRECTORY, 'review-manifest.json');
const DECISIONS_PATH = resolve(ROOT, 'tests/fixtures/image-crops/review-decisions.json');
const TAXONOMY_PATH = resolve(ROOT, 'tests/fixtures/meaning-taxonomy/dataset.json');
const OUTPUT_DIRECTORY = resolve(ROOT, 'tests/fixtures/image-crops');
const REPORT_PATH = resolve(ROOT, 'docs/meaning-taxonomy-training/diagnostics/crops.json');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const unitVector = (vector, label) => {
  assert(Array.isArray(vector), `${label}: missing vector`);
  assert.equal(vector.length, CLIP_DIMENSION, `${label}: wrong vector dimension`);
  assert(vector.every(Number.isFinite), `${label}: vector has non-finite values`);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  assert(Math.abs(norm - 1) <= 1e-5, `${label}: vector is not unit normalized (${norm})`);
  return vector;
};

function cosine(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function normalizeHeadword(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function taxonomyLeakageSets(sourceTaxonomy) {
  const heldoutHeadwords = new Set();
  const heldoutFamilies = new Set();
  const quarantinedCaseIds = new Set();
  for (const row of sourceTaxonomy.items || []) {
    if (row.split === 'quarantine') {
      for (const caseId of row.sourceCaseIds || []) quarantinedCaseIds.add(caseId);
    }
    if (row.split === 'train') continue;
    const headword = normalizeHeadword(row.word);
    if (headword) heldoutHeadwords.add(headword);
    if (row.familyId) heldoutFamilies.add(row.familyId);
  }
  return { heldoutHeadwords, heldoutFamilies, quarantinedCaseIds };
}

function indexReviewedParents(cases) {
  const byCaseId = new Map();
  const heldoutHashes = new Set();
  const selectedTrainHashes = [];
  for (const item of cases) {
    if (item.split !== 'train') {
      for (const candidate of item.candidates || []) heldoutHashes.add(candidate.sha256);
      continue;
    }
    const selected = item.feedback?.selected || [];
    assert.equal(selected.length, 1, `${item.id}: expected one reviewed positive train photo`);
    const matches = item.candidates.filter(candidate => candidate.id === selected[0]);
    assert.equal(matches.length, 1, `${item.id}: selected train photo missing or ambiguous`);
    selectedTrainHashes.push(matches[0].sha256);
    byCaseId.set(item.id, { item, candidate: matches[0] });
  }
  assert.equal(new Set(selectedTrainHashes).size, selectedTrainHashes.length,
    'Selected training parent photo hashes must be unique.');
  assert.equal(selectedTrainHashes.filter(hash => heldoutHashes.has(hash)).length, 0,
    'Selected training parent photo hash overlaps validation/test.');
  return { byCaseId, heldoutHashes };
}

/** Validate complete decision coverage and source/photo/crop hash identity. */
export function validateDecisions({ casesBytes, reviewBytes, decisionsBytes, cropManifest, sourceCases,
  sourceTaxonomy = { items: [] }, taxonomyBytes = Buffer.from(JSON.stringify(sourceTaxonomy)) }) {
  const sourceManifestSha256 = sha256(casesBytes);
  const draftManifestSha256 = sha256(reviewBytes);
  const meaningTaxonomySha256 = sha256(taxonomyBytes);
  const decisions = JSON.parse(decisionsBytes.toString('utf8'));
  assert.equal(decisions.sourceManifestSha256, sourceManifestSha256,
    'Review decisions refer to different source cases bytes.');
  assert.equal(decisions.draftManifestSha256, draftManifestSha256,
    'Review decisions refer to different crop review-manifest bytes.');
  assert.equal(decisions.meaningTaxonomySha256, meaningTaxonomySha256,
    'Review decisions refer to different meaning taxonomy bytes.');
  assert.equal(decisions.reviewType, 'AI visual review; not human-expert ground truth',
    'Review decisions must preserve the required AI review provenance.');
  assert.equal(decisions.reviewedCount, cropManifest.entries.length,
    'Review decisions must cover every crop manifest entry.');
  assert.equal(cropManifest.entries.length, 385,
    'Expected the complete 385-entry reviewed train crop manifest.');
  assert.equal(decisions.decisions.length, cropManifest.entries.length,
    'Decision list must contain exactly one decision per crop.');
  const approvedDecisionCount = decisions.decisions.filter(row => row.status === 'approved').length;
  const rejectedDecisionCount = decisions.decisions.filter(row => row.status === 'rejected').length;
  if (decisions.approvedCount !== undefined) assert.equal(decisions.approvedCount, approvedDecisionCount);
  if (decisions.rejectedCount !== undefined) assert.equal(decisions.rejectedCount, rejectedDecisionCount);

  const { byCaseId, heldoutHashes } = indexReviewedParents(sourceCases.cases);
  const { heldoutHeadwords, heldoutFamilies, quarantinedCaseIds } = taxonomyLeakageSets(sourceTaxonomy);
  const entryByIndex = new Map(cropManifest.entries.map(entry => [entry.reviewIndex, entry]));
  assert.equal(entryByIndex.size, cropManifest.entries.length, 'Crop review indices must be unique.');
  const decisionsByIndex = new Map();
  for (const decision of decisions.decisions) {
    assert(Number.isInteger(decision.reviewIndex), 'Decision reviewIndex must be an integer.');
    assert(!decisionsByIndex.has(decision.reviewIndex), `Duplicate decision index ${decision.reviewIndex}.`);
    const entry = entryByIndex.get(decision.reviewIndex);
    assert(entry, `Decision index ${decision.reviewIndex} is not in the crop manifest.`);
    assert.equal(entry.split, 'train', `Crop ${entry.reviewIndex} is not train-only.`);
    assert.equal(decision.parentSha256, entry.parentSha256,
      `Decision ${entry.reviewIndex} parent hash does not match the crop manifest.`);
    assert.equal(decision.cropSha256, entry.cropSha256,
      `Decision ${entry.reviewIndex} crop hash does not match the crop manifest.`);
    assert(['approved', 'rejected'].includes(decision.status),
      `Decision ${entry.reviewIndex} must be approved or rejected.`);
    assert.equal(typeof decision.reason, 'string');
    assert(decision.reason.trim().length > 0, `Decision ${entry.reviewIndex} requires a reason.`);
    const source = byCaseId.get(entry.caseId);
    assert(source, `Crop ${entry.reviewIndex} has no train source case.`);
    assert.equal(source.item.meaningId, entry.meaningId, `Crop ${entry.reviewIndex} meaning mismatch.`);
    assert.equal(source.candidate.id, entry.parentCandidateId,
      `Crop ${entry.reviewIndex} parent candidate ID does not match selected source.`);
    assert.equal(source.candidate.sha256, entry.parentSha256,
      `Crop ${entry.reviewIndex} parent is not the selected source photo.`);
    assert.equal(source.candidate.file, entry.parentPath,
      `Crop ${entry.reviewIndex} parent path does not match source fixture.`);
    assert(!heldoutHashes.has(entry.parentSha256),
      `Crop ${entry.reviewIndex} parent hash overlaps validation/test.`);
    if (decision.status === 'approved') {
      const headword = normalizeHeadword(source.item.word.word);
      assert(!heldoutHeadwords.has(headword),
        `Approved crop ${entry.reviewIndex} headword overlaps a heldout meaning taxonomy split.`);
      assert(!heldoutFamilies.has(source.item.familyId),
        `Approved crop ${entry.reviewIndex} family overlaps a heldout meaning taxonomy split.`);
      assert(!quarantinedCaseIds.has(entry.caseId),
        `Approved crop ${entry.reviewIndex} case belongs to a quarantined meaning taxonomy row.`);
    }
    decisionsByIndex.set(decision.reviewIndex, decision);
  }
  assert.equal(decisionsByIndex.size, entryByIndex.size, 'Every crop entry must have one decision.');
  return { decisions, decisionsByIndex, sourceManifestSha256, draftManifestSha256, meaningTaxonomySha256,
    decisionsSha256: sha256(decisionsBytes), byCaseId };
}

async function checkedFile(directory, relativePath, expectedHash, label) {
  assert.equal(typeof relativePath, 'string', `${label}: missing relative image path.`);
  assert(!relativePath.startsWith('/') && !relativePath.split(/[\\/]/).includes('..'),
    `${label}: unsafe image path.`);
  const absolute = resolve(directory, relativePath);
  assert(absolute.startsWith(`${directory}/`), `${label}: image path leaves its allowed directory.`);
  const bytes = await readFile(absolute);
  assert.equal(sha256(bytes), expectedHash, `${label}: image SHA-256 mismatch.`);
  return absolute;
}

async function embedImage(runtime, file, id) {
  return unitVector(await runtime.embedImage({ id, file }), id);
}

async function main() {
  try {
    await access(DECISIONS_PATH);
  } catch {
    throw new Error(`Missing AI review decisions: ${DECISIONS_PATH}. Refusing to encode pending crops.`);
  }
  const [casesBytes, reviewBytes, decisionsBytes, taxonomyBytes] = await Promise.all([
    readFile(CASES_PATH), readFile(REVIEW_PATH), readFile(DECISIONS_PATH), readFile(TAXONOMY_PATH)
  ]);
  const sourceCases = JSON.parse(casesBytes.toString('utf8'));
  const cropManifest = JSON.parse(reviewBytes.toString('utf8'));
  const sourceTaxonomy = JSON.parse(taxonomyBytes.toString('utf8'));
  assert.equal(cropManifest.summary?.trainParents, 385, 'Unexpected crop review parent count.');
  assert.equal(cropManifest.summary?.pendingCrops, 385, 'Expected 385 pending crop rows before review.');
  assert.equal(cropManifest.summary?.approvedCrops, 0, 'Draft manifest must remain unreviewed/read-only.');
  assert(cropManifest.entries.every(entry => entry.reviewStatus === 'pending' && entry.trainingEligible === false),
    'Draft crop manifest must remain pending and ineligible for training.');
  const validated = validateDecisions({ casesBytes, reviewBytes, decisionsBytes, cropManifest, sourceCases,
    sourceTaxonomy, taxonomyBytes });

  const entries = cropManifest.entries;
  const approved = entries.filter(entry => validated.decisionsByIndex.get(entry.reviewIndex).status === 'approved');
  const uniqueCropEntries = [];
  const firstByCropHash = new Map();
  for (const entry of approved) {
    if (firstByCropHash.has(entry.cropSha256)) continue;
    firstByCropHash.set(entry.cropSha256, entry);
    uniqueCropEntries.push(entry);
  }
  const candidates = new Map();
  for (const entry of uniqueCropEntries) {
    const { item, candidate } = validated.byCaseId.get(entry.caseId);
    candidates.set(entry.caseId, { item, candidate, entry,
      decision: validated.decisionsByIndex.get(entry.reviewIndex) });
  }
  const meanings = new Map();
  for (const { item } of candidates.values()) {
    const prompt = `A photo illustrating ${item.word.word} (${item.word.partOfSpeech || 'word'}): ${item.word.definition}`;
    const previous = meanings.get(item.meaningId);
    assert(!previous || previous.prompt === prompt,
      `Meaning ${item.meaningId} has inconsistent source text.`);
    meanings.set(item.meaningId, { meaningId: item.meaningId, familyId: item.familyId,
      word: item.word.word, partOfSpeech: item.word.partOfSpeech || null,
      definition: item.word.definition, prompt, promptSha256: sha256(Buffer.from(prompt)) });
  }

  for (const { candidate, entry } of candidates.values()) {
    await checkedFile(PARENT_DIRECTORY, candidate.file, candidate.sha256, `${entry.caseId} parent`);
    await checkedFile(CROP_DIRECTORY, entry.cropPath, entry.cropSha256, `${entry.caseId} crop`);
  }

  const vectorByHash = new Map();
  const vectorRows = [];
  const meaningVectorRows = [];
  const meaningVectorById = new Map();
  const parents = [...candidates.values()];
  const parentRuntime = await imageEvaluationRuntime({
    directory: PARENT_DIRECTORY,
    cacheDir: resolve(ROOT, 'work/image-pretraining/cache'),
    allowDownloads: false,
  });
  try {
    const meaningRows = [...meanings.values()];
    const encodedMeanings = await parentRuntime.embedTexts(meaningRows.map(row => row.prompt));
    assert.equal(encodedMeanings.length, meaningRows.length, 'Meaning embedding count mismatch.');
    for (let index = 0; index < meaningRows.length; index++) {
      const meaning = meaningRows[index];
      const vector = unitVector(encodedMeanings[index], `meaning ${meaning.meaningId}`);
      const vectorId = `meaning:${meaning.meaningId}`;
      meaningVectorById.set(meaning.meaningId, vectorId);
      meaningVectorRows.push({ id: vectorId, meaningId: meaning.meaningId,
        familyId: meaning.familyId, prompt: meaning.prompt,
        promptSha256: meaning.promptSha256, vector });
    }
    for (let index = 0; index < parents.length; index++) {
      const { candidate } = parents[index];
      const key = `parent:${candidate.sha256}`;
      if (vectorByHash.has(key)) continue;
      const vector = await embedImage(parentRuntime, candidate.file, candidate.id);
      vectorByHash.set(key, vector);
      vectorRows.push({ id: key, kind: 'original-parent-photo', imageSha256: candidate.sha256, vector });
      if ((index + 1) % 25 === 0 || index + 1 === parents.length) {
        console.log(`Encoded ${index + 1}/${parents.length} approved parent photos.`);
      }
    }
  } finally {
    await parentRuntime.dispose();
  }

  const cropRuntime = await imageEvaluationRuntime({
    directory: CROP_DIRECTORY,
    cacheDir: resolve(ROOT, 'work/image-pretraining/cache'),
    allowDownloads: false,
  });
  try {
    for (let index = 0; index < uniqueCropEntries.length; index++) {
      const entry = uniqueCropEntries[index];
      const key = `crop:${entry.cropSha256}`;
      if (vectorByHash.has(key)) continue;
      const vector = await embedImage(cropRuntime, entry.cropPath, `crop-${entry.reviewIndex}`);
      vectorByHash.set(key, vector);
      vectorRows.push({ id: key, kind: 'approved-crop', imageSha256: entry.cropSha256, vector });
      if ((index + 1) % 25 === 0 || index + 1 === uniqueCropEntries.length) {
        console.log(`Encoded ${index + 1}/${uniqueCropEntries.length} approved unique crops.`);
      }
    }
  } finally {
    await cropRuntime.dispose();
  }

  const pairs = [];
  const augmentationGroups = [];
  for (const { item, candidate, entry, decision } of candidates.values()) {
    const parentKey = `parent:${candidate.sha256}`;
    const cropKey = `crop:${entry.cropSha256}`;
    const parentVector = vectorByHash.get(parentKey);
    const cropVector = vectorByHash.get(cropKey);
    const meaningVectorId = meaningVectorById.get(item.meaningId);
    const groupId = `parent-photo:${candidate.sha256}`;
    const groupIds = [`meaning-family:${item.familyId}`, groupId];
    const license = sourceCases.source?.licenses?.find(itemLicense =>
      itemLicense.id === candidate.licenseId) || null;
    const originalPhoto = {
        candidateId: candidate.id,
        file: candidate.file,
        sha256: candidate.sha256,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        datasetUrl: candidate.url,
        licenseId: candidate.licenseId,
        license,
        vectorId: parentKey,
      };
    const crop = {
        file: entry.cropPath,
        sha256: entry.cropSha256,
        boxXYXY: entry.crop.boxXYXY,
        sourceDimensions: entry.crop.sourceDimensions,
        dimensions: entry.crop.dimensions,
        retainedAreaFraction: entry.crop.retainedAreaFraction,
        vectorId: cropKey,
      };
    const review = { type: validated.decisions.reviewType, status: decision.status,
      reason: decision.reason, reviewIndex: decision.reviewIndex };
    const parentCropCosine = Number(cosine(parentVector, cropVector).toFixed(8));
    const common = {
      caseId: item.id,
      meaningId: item.meaningId,
      familyId: item.familyId,
      groupIds,
      word: item.word.word,
      partOfSpeech: item.word.partOfSpeech || null,
      definition: item.word.definition,
      meaningPrompt: meanings.get(item.meaningId).prompt,
      meaningVectorId,
      split: 'train',
      label: 1,
      labelMeaning: 'image depicts the meaning represented by the text prompt',
      isIndependentPhoto: false,
      parentPhotoGroupId: groupId,
      parentPhoto: originalPhoto,
      approvedCrop: crop,
      cropReview: review,
    };
    pairs.push({ ...common, id: `semantic-pair-${String(entry.reviewIndex).padStart(3, '0')}-original`,
      imageVariant: 'original-parent', isIndependentPhoto: true, imageVectorId: parentKey,
      imageSha256: candidate.sha256, imageFile: candidate.file,
      image: originalPhoto, relatedParentCropCosine: parentCropCosine });
    pairs.push({ ...common, id: `semantic-pair-${String(entry.reviewIndex).padStart(3, '0')}-crop`,
      imageVariant: 'approved-crop', imageVectorId: cropKey,
      imageSha256: entry.cropSha256, imageFile: entry.cropPath,
      image: crop, relatedParentCropCosine: parentCropCosine });
    augmentationGroups.push({ id: groupId, caseId: item.id, meaningId: item.meaningId,
      familyId: item.familyId, groupIds, parentPhoto: originalPhoto, crop, review,
      parentCropCosine });
  }

    const rejected = entries.filter(entry =>
      validated.decisionsByIndex.get(entry.reviewIndex).status === 'rejected').map(entry => {
      const { item, candidate } = validated.byCaseId.get(entry.caseId);
      const decision = validated.decisionsByIndex.get(entry.reviewIndex);
      const license = sourceCases.source?.licenses?.find(itemLicense =>
        itemLicense.id === candidate.licenseId) || null;
      return { caseId: item.id, meaningId: item.meaningId, familyId: item.familyId,
        word: item.word.word, definition: item.word.definition,
        parentPhoto: { candidateId: candidate.id, file: candidate.file,
          sha256: candidate.sha256, source: candidate.source, sourceUrl: candidate.sourceUrl,
          datasetUrl: candidate.url, licenseId: candidate.licenseId, license },
        crop: { file: entry.cropPath, sha256: entry.cropSha256,
          boxXYXY: entry.crop.boxXYXY, retainedAreaFraction: entry.crop.retainedAreaFraction },
        review: { type: validated.decisions.reviewType, status: decision.status,
          reason: decision.reason, reviewIndex: decision.reviewIndex },
        originalPositiveDisposition: 'needs-re-audit-before-inclusion-as-a-clean-positive' };
    });
    const legacyReferencePositiveCount = 385;
    const approvedParentCount = uniqueCropEntries.length;
    const reviewedPositivePairCount = pairs.length;
    const durableManifest = {
      schemaVersion: 1,
      kind: 'reviewed-train-image-crop-positive-pairs',
      targetTask: 'semantic',
      taskUse: 'image-semantic-personalizer training only; not text-classifier augmentation',
      source: {
        casesFile: 'tests/fixtures/image-pretraining-v2/cases.json',
        casesFileSha256: validated.sourceManifestSha256,
        meaningTaxonomyFile: 'tests/fixtures/meaning-taxonomy/dataset.json',
        meaningTaxonomySha256: validated.meaningTaxonomySha256,
        draftReviewManifestSha256: validated.draftManifestSha256,
        decisionsFile: 'tests/fixtures/image-crops/review-decisions.json',
        decisionsFileSha256: validated.decisionsSha256,
        reviewType: validated.decisions.reviewType,
        reviewedCount: validated.decisions.reviewedCount,
        reviewer: validated.decisions.reviewer || null,
        reviewMethod: validated.decisions.method || null,
      },
      splitPolicy: 'Train only. Every crop remains grouped with its original train parent photo and meaning; no crop is an independent photo.',
      labelPolicy: 'Each label-1 pair is an image (original parent or approved crop) matched to its meaning text embedding. Approved parents and their crops each contribute one positive semantic pair. No new negative pairs are created. Excluded legacy parent positives require separate re-audit before clean training use.',
      summary: {
        legacyReferencePositiveCount,
        approvedCropDecisionCount: approved.length,
        approvedParentCount,
        reviewedPositivePairCount,
        eligibleSubsetMultiplier: 2,
        independentAcceptedParentPhotos: approvedParentCount,
        rejectedParentPositiveCount: rejected.length,
        rejectedParentDisposition: 'needs re-audit; excluded from clean positive pairs',
        parentBalancedTrainingWeights: { original: 0.5, crop: 0.5,
          recommendation: 'Weight each accepted parent-photo group equally, splitting its weight evenly across original and crop pairs.' },
        deduplicatedApprovedCropHashes: approved.length - uniqueCropEntries.length,
        validationCropCount: 0,
        testCropCount: 0,
        negativeCropCount: 0,
        textClassifierAugmentation: false,
      },
      rejectedParentPositivesNeedingReaudit: rejected,
      augmentationGroups,
      pairs,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(durableManifest, null, 2)}\n`);
    const manifestFileSha256 = sha256(manifestBytes);
    const embeddingArtifact = {
      schemaVersion: 1,
      kind: 'reviewed-train-image-crop-positive-pairs',
      targetTask: 'semantic',
      encoder: CLIP_TAG,
      dimension: CLIP_DIMENSION,
      preprocessing: cropRuntime.preprocessing,
      evidence: 'pixels',
      manifestFileSha256,
      vectors: vectorRows,
      meaningVectors: meaningVectorRows,
      pairs: pairs.map(pair => ({
        id: pair.id,
        caseId: pair.caseId,
        meaningId: pair.meaningId,
        familyId: pair.familyId,
        groupIds: pair.groupIds,
        meaningVectorId: pair.meaningVectorId,
        imageVectorId: pair.imageVectorId,
        imageVariant: pair.imageVariant,
        split: pair.split,
        label: pair.label,
        labelMeaning: pair.labelMeaning,
        isIndependentPhoto: pair.isIndependentPhoto,
        parentCropCosine: pair.relatedParentCropCosine,
        reviewIndex: pair.cropReview.reviewIndex,
      })),
    };
    const report = {
      kind: 'image-crop-augmentation-encoding-report',
      taskUse: 'image-semantic-personalizer training only; not text-classifier augmentation',
      sourceManifestSha256: validated.sourceManifestSha256,
      meaningTaxonomySha256: validated.meaningTaxonomySha256,
      draftManifestSha256: validated.draftManifestSha256,
      decisionsSha256: validated.decisionsSha256,
      reviewType: validated.decisions.reviewType,
      legacyReferencePositiveCount,
      approvedParentCount,
      rejectedParentPositiveCount: rejected.length,
      rejectedParentDisposition: 'needs re-audit; excluded from clean positive pairs',
      reviewedPositivePairCount,
      eligibleSubsetMultiplier: 2,
      independentAcceptedParentPhotos: approvedParentCount,
      parentBalancedTrainingWeights: { original: 0.5, crop: 0.5,
        recommendation: 'Weight each accepted parent-photo group equally, splitting its weight evenly across original and crop pairs.' },
      duplicateCropHashesSkipped: approved.length - uniqueCropEntries.length,
      validationTestCropCount: 0,
      negativeCropCount: 0,
      parentCropCosine: {
        count: augmentationGroups.length,
        mean: augmentationGroups.length ? Number((augmentationGroups.reduce((sum, group) => sum + group.parentCropCosine, 0) / augmentationGroups.length).toFixed(8)) : null,
        minimum: augmentationGroups.length ? Math.min(...augmentationGroups.map(group => group.parentCropCosine)) : null,
        maximum: augmentationGroups.length ? Math.max(...augmentationGroups.map(group => group.parentCropCosine)) : null,
      },
      meaningVectorCount: meaningVectorRows.length,
      artifacts: {
        manifest: 'tests/fixtures/image-crops/manifest.json',
        embeddings: 'tests/fixtures/image-crops/embeddings.json.gz',
      },
    };

    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    await mkdir(dirname(REPORT_PATH), { recursive: true });
    const encodedBytes = gzipSync(Buffer.from(JSON.stringify(embeddingArtifact)), { level: 9, mtime: 0 });
    await writeFile(resolve(OUTPUT_DIRECTORY, 'manifest.json'), manifestBytes);
    await writeFile(resolve(OUTPUT_DIRECTORY, 'embeddings.json.gz'), encodedBytes);
    await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
