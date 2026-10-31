#!/usr/bin/env node
/** Prepare leakage-aware current-encoder semantic pairs for adapter experiments.
 *
 * Requires an explicitly selected offline six-category classifier artifact:
 *   node scripts/prepare-clip-adapter-data.mjs --classifier tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json
 *
 * This is a data converter only. It does not train an adapter, create user
 * preference labels, activate a model, or download images/models.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { CLIP_DIMENSION, CLIP_TAG } from '../js/ml/clipConfig.js';
import { decodeFeatures, cosine, normalizedVector } from '../js/services/imagePreferences.js';
import { meaningCategoryProbabilities, validMeaningCategoryClassifier } from './lib/meaning-category-classifier.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_PATH = resolve(ROOT, 'tests/fixtures/image-pretraining-v2/cases.json');
const EMBEDDINGS_PATH = resolve(ROOT, 'tests/fixtures/image-pretraining-fp16/embeddings.json.gz');
const TAXONOMY_PATH = resolve(ROOT, 'tests/fixtures/meaning-taxonomy/dataset.json');
const TAXONOMY_EMBEDDINGS_PATH = resolve(ROOT, 'tests/fixtures/meaning-taxonomy/embeddings.json.gz');
const CROP_MANIFEST_PATH = resolve(ROOT, 'tests/fixtures/image-crops/manifest.json');
const CROP_EMBEDDINGS_PATH = resolve(ROOT, 'tests/fixtures/image-crops/embeddings.json.gz');
const CROP_DECISIONS_PATH = resolve(ROOT, 'tests/fixtures/image-crops/review-decisions.json');
const DEFAULT_OUTPUT = resolve(ROOT, 'tests/fixtures/clip-adapter-training');
const PREPROCESSING = 'full-frame-letterbox-256-v1';
const CATEGORIES = ['entity', 'place', 'action', 'state', 'relation', 'abstract'];
const VECTOR_TOLERANCE = 1e-6;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const safeWord = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const promptFor = item => `A photo illustrating ${item.word} (${item.partOfSpeech || 'word'}): ${item.definition}`;
const vectorId = (modality, hash) => `${modality}:${hash}`;
const asJson = bytes => JSON.parse(bytes.toString('utf8'));

function parseArgs(argv) {
  let classifierPath = '';
  let outputDirectory = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--classifier') {
      if (classifierPath || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--classifier requires one explicit artifact path.');
      classifierPath = resolve(ROOT, argv[++i]);
    } else if (argv[i] === '--output-dir') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--output-dir requires a path.');
      outputDirectory = resolve(ROOT, argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/prepare-clip-adapter-data.mjs --classifier <selected-valid-artifact.json> [--output-dir <directory>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!classifierPath) throw new Error('An explicitly selected classifier is required: pass --classifier <path>. No classifier default is used.');
  return { classifierPath, outputDirectory };
}

function readEmbedding(encoded, label) {
  assert.equal(typeof encoded, 'string', `${label}: missing encoded vector.`);
  assert(encoded.startsWith('f32:'), `${label}: expected a full-precision f32 vector, not quantized preference features.`);
  const decoded = decodeFeatures(encoded);
  assert.equal(decoded.length, CLIP_DIMENSION + 3, `${label}: expected 512 CLIP coordinates plus three legacy score fields.`);
  const vector = normalizedVector(decoded.slice(0, CLIP_DIMENSION), CLIP_DIMENSION);
  return vector;
}

function unitVector(values, label) {
  assert(Array.isArray(values) || ArrayBuffer.isView(values), `${label}: missing vector.`);
  assert.equal(values.length, CLIP_DIMENSION, `${label}: expected ${CLIP_DIMENSION} coordinates.`);
  const vector = Array.from(values);
  assert(vector.every(Number.isFinite), `${label}: non-finite vector value.`);
  return normalizedVector(vector, CLIP_DIMENSION);
}

function checkSimilar(a, b, label) {
  const similarity = cosine(a, b);
  assert(similarity >= 1 - VECTOR_TOLERANCE, `${label}: duplicate source has inconsistent encoded vectors (cosine ${similarity}).`);
}

function addVector(map, row, label) {
  const previous = map.get(row.id);
  if (previous) {
    assert.equal(previous.modality, row.modality, `${label}: vector ID modality collision.`);
    checkSimilar(previous.vector, row.vector, label);
    return previous;
  }
  map.set(row.id, row);
  return row;
}

function addGroupIds(row) {
  row.groupIds = [...new Set(row.groupIds)].sort();
  return row;
}

function unionFind(records) {
  const parent = records.map((_, index) => index);
  const find = index => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) { const next = parent[index]; parent[index] = root; index = next; }
    return root;
  };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const firstByGroup = new Map();
  records.forEach((record, index) => {
    for (const group of record.groupIds) {
      const previous = firstByGroup.get(group);
      if (previous === undefined) firstByGroup.set(group, index);
      else join(index, previous);
    }
  });
  const components = new Map();
  records.forEach((record, index) => {
    const root = find(index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(record);
  });
  for (const members of components.values()) {
    const sourceSplits = [...new Set(members.map(member => member.sourceSplit))].sort();
    const conflict = sourceSplits.length > 1;
    const groupMaterial = [...new Set(members.flatMap(member => member.groupIds))].sort().join('\n');
    const componentId = `component:${sha256(Buffer.from(groupMaterial)).slice(0, 20)}`;
    for (const member of members) {
      member.componentId = componentId;
      member.componentSourceSplits = sourceSplits;
      member.split = conflict ? 'quarantine' : sourceSplits[0];
      member.splitQuarantineReason = conflict ? 'transitive group connects source splits; original split preserved in sourceSplit' : null;
    }
  }
  return components;
}

async function main() {
  const { classifierPath, outputDirectory } = parseArgs(process.argv.slice(2));
  const inputFiles = [CASES_PATH, EMBEDDINGS_PATH, TAXONOMY_PATH, TAXONOMY_EMBEDDINGS_PATH,
    CROP_MANIFEST_PATH, CROP_EMBEDDINGS_PATH, CROP_DECISIONS_PATH, classifierPath];
  const inputBytes = await Promise.all(inputFiles.map(path => readFile(path).catch(error => {
    throw new Error(`Required input not found/readable: ${relative(ROOT, path)} (${error.message})`);
  })));
  const [casesBytes, embeddingsBytes, taxonomyBytes, taxonomyEmbeddingsBytes,
    cropManifestBytes, cropEmbeddingsBytes, cropDecisionsBytes, classifierBytes] = inputBytes;
  const casesManifest = asJson(casesBytes);
  const sourceEmbeddings = asJson(gunzipSync(embeddingsBytes));
  const taxonomy = asJson(taxonomyBytes);
  const taxonomyEmbeddings = asJson(gunzipSync(taxonomyEmbeddingsBytes));
  const cropManifest = asJson(cropManifestBytes);
  const cropEmbeddings = asJson(gunzipSync(cropEmbeddingsBytes));
  const cropDecisions = asJson(cropDecisionsBytes);
  const classifier = asJson(classifierBytes);

  assert(validMeaningCategoryClassifier(classifier), 'Selected classifier is invalid or incompatible with the current six-category CLIP contract.');
  assert.equal(classifier.encoder, CLIP_TAG, 'Selected classifier encoder does not match current CLIP.');
  assert.deepEqual(classifier.categories, CATEGORIES, 'Selected classifier category order is unexpected.');
  assert.equal(classifier.inputProtocol, 'A photo illustrating ${word} (${partOfSpeech || "word"}): ${definition}; original definition only, no labels, rationales, or generated scenes.',
    'Selected classifier does not declare the original-definition-only prompt contract.');
  assert.equal(casesManifest.cases?.length, 638, 'Expected the audited 638-case image manifest.');
  assert.equal(sourceEmbeddings.events?.length, 2390, 'Expected the audited 2,390 current-encoder comparisons.');
  assert.equal(sourceEmbeddings.encoder, CLIP_TAG, 'Source image embeddings do not use current CLIP.');
  assert.equal(sourceEmbeddings.preprocessing, PREPROCESSING, 'Source image embeddings use unexpected preprocessing.');
  assert.equal(sourceEmbeddings.targetTask, 'semantic', 'Preference data cannot be mixed into semantic pairs.');
  assert.equal(cropEmbeddings.pairs?.length, 710, 'Expected 710 reviewed crop/parent positive pairs.');
  assert.equal(cropEmbeddings.encoder, CLIP_TAG, 'Crop embeddings do not use current CLIP.');
  assert.equal(cropEmbeddings.preprocessing, PREPROCESSING, 'Crop embeddings use unexpected preprocessing.');
  assert.equal(cropEmbeddings.targetTask, 'semantic', 'Crop fixture has an unexpected task.');
  assert.equal(cropManifest.targetTask, 'semantic', 'Crop manifest has an unexpected task.');
  assert.equal(cropManifest.source?.casesFileSha256, sha256(casesBytes), 'Crop manifest references different case bytes.');
  assert.equal(cropManifest.source?.meaningTaxonomySha256, sha256(taxonomyBytes), 'Crop manifest references different taxonomy bytes.');
  assert.equal(cropEmbeddings.manifestFileSha256, sha256(cropManifestBytes), 'Crop vectors refer to a different crop manifest.');
  assert.equal(cropManifest.source?.decisionsFileSha256, sha256(cropDecisionsBytes), 'Crop manifest references different review decisions.');
  assert.equal(cropDecisions.reviewedCount, 385, 'Expected complete review coverage for 385 proposed crops.');
  assert.equal(cropDecisions.reviewType, 'AI visual review; not human-expert ground truth', 'Crop review provenance changed.');
  assert.equal(taxonomyEmbeddings.encoder, CLIP_TAG, 'Taxonomy text vectors do not use current CLIP.');
  assert.equal(taxonomyEmbeddings.dimension, CLIP_DIMENSION, 'Taxonomy text vector dimension mismatch.');
  assert.equal(taxonomyEmbeddings.inputProtocol, classifier.inputProtocol, 'Taxonomy and classifier prompt protocols differ.');
  assert.equal(taxonomyEmbeddings.datasetFileSha256, sha256(taxonomyBytes), 'Taxonomy embeddings refer to different dataset bytes.');

  const cases = casesManifest.cases;
  const caseById = new Map(cases.map(row => [row.id, row]));
  assert.equal(caseById.size, cases.length, 'Duplicate source case IDs.');
  const taxonomyByExact = new Map();
  for (const row of taxonomy.items) {
    const exactKey = JSON.stringify([safeWord(row.word), safeWord(row.partOfSpeech) || null, row.definition]);
    const previous = taxonomyByExact.get(exactKey) || [];
    previous.push(row);
    taxonomyByExact.set(exactKey, previous);
  }
  const taxonomyVectorById = new Map(taxonomyEmbeddings.rows.map(row => [row.id, row]));
  assert.equal(taxonomyVectorById.size, taxonomyEmbeddings.rows.length, 'Duplicate taxonomy embedding IDs.');
  const quarantineCaseIds = new Set();
  for (const row of taxonomy.items) if (row.split === 'quarantine') for (const id of row.sourceCaseIds || []) quarantineCaseIds.add(id);
  const excludedCropCases = new Set((cropManifest.rejectedParentPositivesNeedingReaudit || []).map(row => row.caseId));
  assert.equal(excludedCropCases.size, 30, 'Expected exactly 30 crop-rejected parent-positive cases to be excluded.');

  const imageVectors = new Map();
  const meaningVectors = new Map();
  const meaningInfo = new Map();
  const probabilityCache = new Map();
  const exclusions = [];
  const caseRecords = new Map();
  const validCaseIds = new Set();

  function resolveMeaning(item) {
    const exactKey = JSON.stringify([safeWord(item.word.word), safeWord(item.word.partOfSpeech) || null, item.word.definition]);
    const matches = taxonomyByExact.get(exactKey) || [];
    assert.equal(matches.length, 1, `${item.id}: exact word/POS/definition must match one base taxonomy row.`);
    const row = matches[0];
    const cached = taxonomyVectorById.get(row.id);
    assert(cached, `${item.id}: exact taxonomy text vector not found.`);
    const prompt = promptFor({ word: row.word, partOfSpeech: row.partOfSpeech, definition: row.definition });
    assert.equal(cached.promptSha256, sha256(Buffer.from(prompt)), `${item.id}: taxonomy prompt hash mismatch.`);
    const textVector = unitVector(cached.vector, `${item.id} taxonomy text`);
    return { row, prompt, promptSha256: sha256(Buffer.from(prompt)), textVector };
  }

  function meaningRecord(item) {
    const resolved = resolveMeaning(item);
    const promptKey = resolved.promptSha256;
    const existing = meaningInfo.get(promptKey);
    if (existing) {
      assert.equal(existing.prompt, resolved.prompt, 'Prompt hash collision.');
      checkSimilar(existing.vector, resolved.textVector, `meaning ${promptKey}`);
      existing.meaningIds = [...new Set([...existing.meaningIds, item.meaningId])].sort();
      existing.familyIds = [...new Set([...existing.familyIds, item.familyId])].sort();
      existing.sourceCaseIds = [...new Set([...existing.sourceCaseIds, item.id])].sort();
      return existing;
    }
    const id = vectorId('meaning', promptKey);
    const info = { id, meaningIds: [item.meaningId], familyIds: [item.familyId], sourceCaseIds: [item.id],
      word: item.word.word, partOfSpeech: item.word.partOfSpeech || null,
      definition: item.word.definition, prompt: resolved.prompt, promptSha256: promptKey,
      vector: resolved.textVector };
    meaningInfo.set(promptKey, info);
    meaningVectors.set(id, info);
    return info;
  }

  function categoryInfo(meaning) {
    if (probabilityCache.has(meaning.id)) return probabilityCache.get(meaning.id);
    const probabilities = meaningCategoryProbabilities(classifier, meaning.vector);
    assert.equal(probabilities.length, CATEGORIES.length, 'Classifier did not return all six probabilities.');
    assert(probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'Classifier returned invalid probabilities.');
    const sum = probabilities.reduce((total, value) => total + value, 0);
    const weights = sum > 0 ? probabilities.map(value => value / sum) : probabilities.map(() => 1 / CATEGORIES.length);
    const result = { categoryProbabilities: probabilities, routerWeights: weights,
      routerFallback: sum > 0 ? null : 'uniform_zero_probability_sum' };
    probabilityCache.set(meaning.id, result);
    return result;
  }

  function addImage(hash, values, variant, parentHash = null) {
    assert.match(hash, /^[a-f0-9]{64}$/, `Invalid image SHA-256: ${hash}`);
    const vector = unitVector(values, `image ${hash}`);
    const id = vectorId('image', hash);
    return addVector(imageVectors, { id, modality: 'image', assetSha256: hash,
      variant, parentImageSha256: parentHash, vector }, `image hash ${hash}`);
  }

  const eventByCase = new Map();
  for (const event of sourceEmbeddings.events) {
    assert.equal(event.task, 'semantic', `${event.id}: non-semantic training task.`);
    assert.equal(event.kind, 'comparison', `${event.id}: expected explicit comparison.`);
    assert.equal(event.label, 0, `${event.id}: comparison label must mean a reviewed wrong candidate.`);
    assert.equal(event.id, event.key, `${event.id}: event ID/key mismatch.`);
    assert.equal(event.encoder, CLIP_TAG, `${event.id}: encoder mismatch.`);
    assert.equal(event.preprocessing, PREPROCESSING, `${event.id}: preprocessing mismatch.`);
    const sourceCase = caseById.get(event.decisionId);
    assert(sourceCase, `${event.id}: unknown decision/case ID.`);
    if (!eventByCase.has(event.decisionId)) eventByCase.set(event.decisionId, []);
    eventByCase.get(event.decisionId).push(event);
  }

  // Validate every positive first. If one is invalid/rejected/quarantined, all
  // wrong-image comparisons for that gallery are excluded as required.
  for (const item of cases) {
    if (quarantineCaseIds.has(item.id)) {
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: 'taxonomy meaning group is quarantined' });
      continue;
    }
    if (excludedCropCases.has(item.id)) {
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: 'selected positive parent was crop-review rejected and requires re-audit' });
      continue;
    }
    const selected = item.feedback?.selected || [];
    const selectedCandidate = item.candidates?.find(candidate => candidate.id === selected[0]);
    if (selected.length !== 1 || !selectedCandidate?.sha256) {
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: 'gallery lacks exactly one hash-bound selected positive' });
      continue;
    }
    if (!['train', 'validation', 'test'].includes(item.split)) {
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: 'unsupported source split' });
      continue;
    }
    const meaning = meaningRecord(item);
    const expectedEvents = new Set(item.feedback.wrong || []);
    const rows = eventByCase.get(item.id) || [];
    const firstPositiveEvent = rows[0];
    if (!firstPositiveEvent) {
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: 'gallery has no explicit image comparison event from which to recover its selected positive' });
      continue;
    }
    let positiveVector;
    try {
      positiveVector = addImage(selectedCandidate.sha256,
        readEmbedding(firstPositiveEvent.preferredFeatures, `${item.id} positive`), 'original');
    } catch (error) {
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: `selected positive vector invalid: ${error.message}` });
      continue;
    }
    const seenWrongIds = new Set();
    let invalid = false;
    for (const event of rows) {
      const [eventCaseId, candidateId] = String(event.key || '').split(':');
      const candidate = item.candidates.find(row => row.id === candidateId);
      const urlMatch = item.candidates.filter(row => row.url === event.context?.imageUrl);
      const preferredUrlMatch = item.candidates.filter(row => row.url === event.context?.preferredUrl);
      if (eventCaseId !== item.id || !candidate || candidateId !== String(event.id).slice(String(event.id).lastIndexOf(':') + 1)
        || urlMatch.length !== 1 || urlMatch[0].id !== candidateId || preferredUrlMatch.length !== 1
        || preferredUrlMatch[0].id !== selected[0] || event.meaningId !== item.meaningId
        || event.context?.word !== item.word.word || event.context?.definition !== item.word.definition
        || !expectedEvents.has(candidateId) || seenWrongIds.has(candidateId)) {
        invalid = true;
        break;
      }
      let eventMeaningVector;
      try { eventMeaningVector = readEmbedding(event.meaningFeatures, `${event.id} target meaning`); }
      catch { invalid = true; break; }
      if (cosine(eventMeaningVector, meaning.vector) < 1 - VECTOR_TOLERANCE) {
        invalid = true;
        break;
      }
      seenWrongIds.add(candidateId);
      const negativeVector = addImage(candidate.sha256, readEmbedding(event.features, `${event.id} wrong image`), 'original');
      let currentPositive;
      try {
        currentPositive = addImage(selectedCandidate.sha256, readEmbedding(event.preferredFeatures, `${event.id} positive image`), 'original');
      } catch {
        invalid = true;
        break;
      }
      if (currentPositive.id !== positiveVector.id) {
        invalid = true;
        break;
      }
      const categories = categoryInfo(meaning);
      const sourceId = `${event.decisionId}:${candidateId}`;
      const triplet = addGroupIds({
        id: `triplet:${sourceId}`,
        caseId: item.id,
        meaningId: item.meaningId,
        meaningVectorId: meaning.id,
        positiveImageVectorId: positiveVector.id,
        negativeImageVectorId: negativeVector.id,
        positiveImageSha256: selectedCandidate.sha256,
        negativeImageSha256: candidate.sha256,
        familyId: item.familyId,
        word: item.word.word,
        sourceSplit: item.split,
        split: item.split,
        source: 'current-encoder-reviewed-comparison',
        reviewStatus: item.annotation?.reviewStatus || 'reviewed-in-fixture',
        reviewRefs: [item.id],
        comparisonWeight: 0,
        ...categories,
        groupIds: [
          `meaning-family:${item.familyId}`,
          `meaning-prompt:${meaning.promptSha256}`,
          `headword:${safeWord(item.word.word)}`,
          `photo:${selectedCandidate.sha256}`,
          `photo:${candidate.sha256}`
        ]
      });
      if (!caseRecords.has(item.id)) caseRecords.set(item.id, { item, meaning, positiveImageVectorId: positiveVector.id, triplets: [] });
      caseRecords.get(item.id).triplets.push(triplet);
    }
    if (!invalid && (seenWrongIds.size !== expectedEvents.size || rows.length !== expectedEvents.size)) invalid = true;
    if (invalid) {
      caseRecords.delete(item.id);
      exclusions.push({ caseId: item.id, sourceSplit: item.split, reason: 'comparison rows did not exactly match case candidate IDs, URLs, target meaning, or selected positive' });
      validCaseIds.delete(item.id);
    } else {
      validCaseIds.add(item.id);
    }
  }

  const triplets = [];
  for (const [caseId, record] of caseRecords) {
    const weight = record.triplets.length ? 1 / record.triplets.length : 0;
    for (const row of record.triplets) { row.comparisonWeight = weight; triplets.push(row); }
  }

  // Deduplicate exact original positive image/meaning pairs across galleries.
  const positiveByPair = new Map();
  for (const [caseId, record] of caseRecords) {
    const image = imageVectors.get(record.positiveImageVectorId);
    const key = `${image.assetSha256}|${record.meaning.promptSha256}`;
    let row = positiveByPair.get(key);
    if (!row) {
      row = addGroupIds({ id: `positive:${sha256(Buffer.from(key)).slice(0, 20)}`,
        meaningId: record.item.meaningId, meaningVectorId: record.meaning.id,
        imageVectorId: image.id, imageSha256: image.assetSha256,
        parentImageSha256: null, imageVariant: 'original', familyId: record.item.familyId,
        word: record.item.word.word, sourceSplit: record.item.split, split: record.item.split,
        source: 'selected-positive-gallery-reference', reviewStatus: record.item.annotation?.reviewStatus || 'reviewed-in-fixture',
        reviewRefs: [], pointPairWeight: 1,
        ...categoryInfo(record.meaning),
        groupIds: [`meaning-family:${record.item.familyId}`, `meaning-prompt:${record.meaning.promptSha256}`,
          `headword:${safeWord(record.item.word.word)}`, `photo:${image.assetSha256}`] });
      positiveByPair.set(key, row);
    }
    assert.equal(row.sourceSplit, record.item.split, `${caseId}: same positive pair crossed source splits.`);
    row.reviewRefs.push(caseId);
  }

  // Join approved crop/parent positives. Parent vectors must agree with the
  // exact hash-deduplicated original image vector. Crops add positive points
  // only; they never inherit a negative label or create validation/test rows.
  const cropVectorById = new Map(cropEmbeddings.vectors.map(row => [row.id, row]));
  const cropMeaningById = new Map(cropEmbeddings.meaningVectors.map(row => [row.id, row]));
  const cropsByParent = new Map();
  for (const pair of cropEmbeddings.pairs) {
    assert.equal(pair.label, 1, `${pair.id}: crop fixture must contain approved positives only.`);
    assert.equal(pair.split, 'train', `${pair.id}: crop data must remain training-only.`);
    assert.equal(pair.labelMeaning, 'image depicts the meaning represented by the text prompt', `${pair.id}: unexpected crop label semantics.`);
    const item = caseById.get(pair.caseId);
    if (!item || !validCaseIds.has(pair.caseId) || quarantineCaseIds.has(pair.caseId) || excludedCropCases.has(pair.caseId)) continue;
    assert.equal(item.split, 'train', `${pair.caseId}: crop case is not a training case.`);
    assert.equal(pair.meaningId, item.meaningId, `${pair.id}: crop meaning mismatch.`);
    assert.equal(pair.familyId, item.familyId, `${pair.id}: crop family mismatch.`);
    const vectorSource = cropVectorById.get(pair.imageVectorId);
    const textSource = cropMeaningById.get(pair.meaningVectorId);
    assert(vectorSource && textSource, `${pair.id}: crop vector reference missing.`);
    const meaning = meaningRecord(item);
    checkSimilar(meaning.vector, unitVector(textSource.vector, `${pair.id} crop text`), `${pair.id} crop meaning`);
    const parentHash = pair.groupIds.find(group => group.startsWith('parent-photo:'))?.slice('parent-photo:'.length);
    assert(parentHash, `${pair.id}: missing parent-photo group.`);
    if (pair.imageVariant === 'original-parent') {
      assert.equal(vectorSource.imageSha256, parentHash, `${pair.id}: parent vector hash mismatch.`);
      assert.equal(pair.imageVectorId, vectorSource.id, `${pair.id}: parent vector reference mismatch.`);
      assert.equal(vectorSource.id, `parent:${parentHash}`, `${pair.id}: parent vector ID malformed.`);
      const parentVector = addImage(parentHash, vectorSource.vector, 'original');
      const mainPair = positiveByPair.get(`${parentHash}|${meaning.promptSha256}`);
      assert(mainPair, `${pair.id}: accepted parent positive was not retained from the main source.`);
      checkSimilar(imageVectors.get(mainPair.imageVectorId).vector, parentVector.vector, `${pair.id} parent image`);
      const parentGroupKey = `${parentHash}|${meaning.promptSha256}`;
      if (!cropsByParent.has(parentGroupKey)) cropsByParent.set(parentGroupKey, { parent: mainPair, crops: [] });
    } else if (pair.imageVariant === 'approved-crop') {
      assert.equal(pair.imageVectorId, vectorSource.id, `${pair.id}: crop vector reference mismatch.`);
      assert.equal(vectorSource.id, `crop:${vectorSource.imageSha256}`, `${pair.id}: crop vector ID/hash malformed.`);
      assert.equal(pair.isIndependentPhoto, false, `${pair.id}: crop cannot count as an independent photo.`);
      const cropHash = vectorSource.imageSha256;
      const cropVector = addImage(cropHash, vectorSource.vector, 'approved-crop', parentHash);
      const parentGroupKey = `${parentHash}|${meaning.promptSha256}`;
      if (!cropsByParent.has(parentGroupKey)) cropsByParent.set(parentGroupKey, { parent: positiveByPair.get(parentGroupKey), crops: [] });
      const group = cropsByParent.get(parentGroupKey);
      assert(group.parent, `${pair.id}: no retained accepted parent positive.`);
      group.crops.push({ pair, vector: cropVector, meaning, item, parentHash });
    } else throw new Error(`${pair.id}: unknown crop image variant ${pair.imageVariant}.`);
  }

  const positivePairs = [...positiveByPair.values()];
  for (const group of cropsByParent.values()) {
    if (!group.crops.length) continue;
    assert.equal(group.crops.length, 1, `${group.parent.id}: expected at most one approved crop per independent parent photo.`);
    group.parent.pointPairWeight = 0.5;
    for (const crop of group.crops) {
      const item = crop.item;
      const categories = categoryInfo(crop.meaning);
      positivePairs.push(addGroupIds({
        id: `positive-crop:${crop.vector.assetSha256}:${crop.meaning.promptSha256}`,
        meaningId: item.meaningId,
        meaningVectorId: crop.meaning.id,
        imageVectorId: crop.vector.id,
        imageSha256: crop.vector.assetSha256,
        parentImageSha256: crop.parentHash,
        imageVariant: 'approved-crop',
        familyId: item.familyId,
        word: item.word.word,
        sourceSplit: 'train', split: 'train',
        source: 'reviewed-train-only-crop-positive',
        reviewStatus: 'AI visual review; not human-expert ground truth',
        reviewRefs: [crop.pair.id], pointPairWeight: 0.5,
        ...categories,
        groupIds: [`meaning-family:${item.familyId}`, `meaning-prompt:${crop.meaning.promptSha256}`,
          `headword:${safeWord(item.word.word)}`,
          `photo:${crop.parentHash}`, `photo:${crop.vector.assetSha256}`, `parent-photo:${crop.parentHash}`]
      }));
    }
  }

  // Link triplets and point pairs into transitive meaning/headword/photo groups.
  const records = [...triplets, ...positivePairs];
  const usedImageVectorIds = new Set(records.flatMap(row => row.id.startsWith('triplet:')
    ? [row.positiveImageVectorId, row.negativeImageVectorId] : [row.imageVectorId]));
  const usedMeaningVectorIds = new Set(records.map(row => row.meaningVectorId));
  const storedImageVectors = [...imageVectors.values()].filter(row => usedImageVectorIds.has(row.id));
  const storedMeaningVectors = [...meaningVectors.values()].filter(row => usedMeaningVectorIds.has(row.id));
  const components = unionFind(records);
  const componentStats = [...components.values()].map(members => ({
    componentId: members[0].componentId,
    recordCount: members.length,
    sourceSplits: members[0].componentSourceSplits,
    split: members[0].split,
    triplets: members.filter(row => row.id.startsWith('triplet:')).length,
    positivePairs: members.filter(row => row.id.startsWith('positive:')).length + members.filter(row => row.id.startsWith('positive-crop:')).length
  })).sort((a, b) => a.componentId.localeCompare(b.componentId));
  const crossSplitComponents = componentStats.filter(row => row.sourceSplits.length > 1);
  const splitSummary = {};
  for (const split of ['train', 'validation', 'test', 'quarantine']) {
    const rows = records.filter(row => row.split === split);
    splitSummary[split] = {
      records: rows.length,
      triplets: rows.filter(row => row.id.startsWith('triplet:')).length,
      positivePairs: rows.filter(row => row.id.startsWith('positive:') || row.id.startsWith('positive-crop:')).length,
      components: new Set(rows.map(row => row.componentId)).size
    };
  }
  assert(positivePairs.every(row => row.imageVariant !== 'approved-crop' || row.split === 'train'), 'Crop derivative escaped training split.');

  const vectors = {
    schemaVersion: 1,
    kind: 'clip-adapter-vector-store',
    dimension: CLIP_DIMENSION,
    encoder: CLIP_TAG,
    preprocessing: PREPROCESSING,
    vectorNormalization: 'unit-l2; extracted from first 512 values of full-f32 515-value source records',
    images: storedImageVectors.sort((a, b) => a.id.localeCompare(b.id)),
    meanings: storedMeaningVectors.sort((a, b) => a.id.localeCompare(b.id))
  };
  const manifest = {
    schemaVersion: 1,
    kind: 'meaning-conditioned-clip-adapter-training-data',
    targetTask: 'semantic',
    personalPreference: false,
    trained: false,
    encoder: CLIP_TAG,
    preprocessing: PREPROCESSING,
    dimension: CLIP_DIMENSION,
    categories: CATEGORIES,
    categoryRouting: {
      classifierPath: relative(ROOT, classifierPath),
      classifierSha256: sha256(classifierBytes),
      classifierModelSha256: sha256(Buffer.from(canonical({ inputDimension: classifier.inputDimension, categories: classifier.categories,
        encoder: classifier.encoder, inputProtocol: classifier.inputProtocol, modelType: classifier.modelType,
        preprocessor: classifier.preprocessor, layers: classifier.layers, calibration: classifier.calibration || null }))),
      classifierProvenance: classifier.provenance || null,
      calibrated: classifier.calibrated === true,
      probabilities: 'six independent sigmoid outputs in category order; no threshold, argmax, or softmax',
      routerWeights: 'probabilities divided by their sum; uniform weights only when the probability sum is zero',
      sourceMeaningOnly: true
    },
    sources: Object.fromEntries(inputFiles.map((path, index) => [relative(ROOT, path), sha256(inputBytes[index])])),
    vectorFile: 'vectors.json.gz',
    vectorFileSha256: sha256(gzipSync(Buffer.from(JSON.stringify(vectors)), { level: 9 })),
    sourceSplitPolicy: 'preserve original image train/validation/test splits; taxonomy quarantine and invalid/rejected positive galleries excluded; transitive cross-split components are quarantined, never moved into train',
    sourceCounts: {
      sourceCases: cases.length,
      sourceComparisonEvents: sourceEmbeddings.events.length,
      sourceCropPairs: cropEmbeddings.pairs.length,
      taxonomyQuarantinedCaseIds: quarantineCaseIds.size,
      cropRejectedParentCaseIds: excludedCropCases.size,
      validCases: validCaseIds.size,
      excludedCases: exclusions.length,
      exclusions
    },
    summary: {
      tripletComparisonRows: triplets.length,
      deduplicatedOriginalPositiveRows: positiveByPair.size,
      cropPositiveRows: positivePairs.filter(row => row.imageVariant === 'approved-crop').length,
      imageVectors: storedImageVectors.length,
      meaningVectors: storedMeaningVectors.length,
      connectedComponents: components.size,
      crossSplitComponentsQuarantined: crossSplitComponents.length,
      crossSplitComponentIds: crossSplitComponents.map(row => row.componentId),
      splitSummary,
      uniqueSourceFamilies: new Set(records.map(row => row.familyId)).size,
      uniqueHeadwords: new Set(records.map(row => safeWord(row.word))).size,
      sourcePhotosAreDeduplicatedBySha256: true,
      sameImageMayAppearWithDifferentMeaningLabels: true,
      cropImagesAreIndependentPhotos: false,
      userPreferenceExamples: 0
    },
    recordWeights: {
      triplets: 'each gallery contributes total weight 1 across its valid wrong-image comparisons',
      pointPairs: 'deduplicated original positive image–meaning pairs; when a reviewed crop is attached, parent and crop each receive 0.5 total parent weight',
      objectives: 'triplet comparisons and positive point pairs are separate objectives; do not let repeated preferredFeatures multiply a photo’s point-pair weight'
    },
    triplets: triplets.sort((a, b) => a.id.localeCompare(b.id)),
    positivePairs: positivePairs.sort((a, b) => a.id.localeCompare(b.id)),
    componentSummary: componentStats
  };

  await mkdir(outputDirectory, { recursive: true });
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const vectorBytes = gzipSync(Buffer.from(JSON.stringify(vectors)), { level: 9 });
  await writeFile(resolve(outputDirectory, 'vectors.json.gz'), vectorBytes);
  await writeFile(resolve(outputDirectory, 'manifest.json'), manifestBytes);
  console.log(JSON.stringify({ outputDirectory: relative(ROOT, outputDirectory),
    manifestSha256: sha256(manifestBytes), vectorStoreSha256: sha256(vectorBytes), summary: manifest.summary }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
