// Replay frozen CLIP predictions; does not train, download photos, or access app storage.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { cosine } from '../js/services/imagePreferences.js';
import { passesImageSemanticGate } from '../js/services/imageSemanticGate.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'tests/fixtures/image-screening-ui');
const json = async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const packed = async name => JSON.parse(gunzipSync(await readFile(resolve(directory, name))));
const policy = { minimumSimilarity: .19, maximumUnwanted: .20, candidatePoolSize: 30 };
const finiteVector = value => Array.isArray(value) && value.length === 512 && value.every(Number.isFinite);

function metrics(rows) {
  let tp = 0, fp = 0, tn = 0, fn = 0, aucWins = 0;
  const positive = rows.filter(row => row.label === 1), negative = rows.filter(row => row.label === 0);
  for (const row of rows) {
    assert.ok([0, 1].includes(row.label));
    const accepted = passesImageSemanticGate(row, policy);
    if (row.label === 1) { if (accepted) tp++; else fn++; }
    else if (accepted) fp++; else tn++;
  }
  for (const a of positive) for (const b of negative) aucWins += a.selected > b.selected ? 1 : a.selected === b.selected ? .5 : 0;
  return { count: rows.length, positives: positive.length, negatives: negative.length, tp, fp, tn, fn,
    positiveRecall: positive.length ? tp / positive.length : null,
    wrongImageAcceptanceRate: negative.length ? fp / negative.length : null,
    acceptedPrecision: tp + fp ? tp / (tp + fp) : null,
    aurocSelected: positive.length && negative.length ? aucWins / (positive.length * negative.length) : null };
}

const [primary, independent, inventory, encoded, older] = await Promise.all([
  json('pexels-primary-review.json'), json('pexels-independent-review.json'), json('pexels-photo-inventory.json'),
  packed('pexels-predictions.json.gz'), packed('keyless-predictions.json.gz')
]);
const predictions = new Map(encoded.predictions.map(row => [row.imageID, row]));
const reviews = new Map(independent.reviews.map(row => [row.galleryId, row]));
const photos = new Map(inventory.galleries.flatMap(gallery => gallery.candidates.map(row => [row.id, row])));
const observations = [], comparisons = [], seen = new Set();
for (const gallery of primary.galleries) {
  const review = reviews.get(gallery.galleryId);
  assert.ok(review, `Missing independent review: ${gallery.galleryId}`);
  for (const candidate of gallery.candidates) {
    assert.ok(!seen.has(candidate.imageID), 'Duplicate observation ID'); seen.add(candidate.imageID);
    const decisions = ['fits', 'wrong', 'uncertain'].filter(label => review[label].includes(candidate.imageID));
    assert.equal(decisions.length, 1, `Independent reviewer must classify ${candidate.imageID} exactly once`);
    const secondLabel = decisions[0];
    const label = candidate.label === secondLabel && secondLabel !== 'uncertain' ? Number(secondLabel === 'fits') : null;
    const prediction = predictions.get(candidate.imageID), photo = photos.get(candidate.imageID);
    assert.ok(prediction && photo?.available);
    assert.equal(prediction.imageSha256, photo.sha256, 'Pixels must match reviewed photo');
    assert.equal(prediction.src, candidate.src, 'Prediction must match actual displayed URL');
    assert.equal(prediction.galleryId, gallery.galleryId);
    assert.equal(prediction.definition, gallery.definition);
    assert.ok(finiteVector(prediction.imageEmbedding512) && finiteVector(prediction.meaningEmbedding512));
    assert.ok(Math.abs(cosine(prediction.imageEmbedding512, prediction.meaningEmbedding512) - prediction.rawTargetCosine) < 1e-6,
      'Raw cosine must be reproducible from retained image and meaning vectors');
    observations.push({ ...prediction, primaryLabel: candidate.label, independentLabel: secondLabel, label,
      task: 'semantic', personalPreference: false, partition: 'evaluation-only' });
  }
  const chosen = observations.find(row => row.imageID === (gallery.selectedImageID || gallery.selected) && row.label === 1);
  if (chosen) for (const alternative of observations.filter(row => row.galleryId === gallery.galleryId && row.label === 0)) {
    comparisons.push({ galleryId: gallery.galleryId, preferred: chosen.imageID, alternative: alternative.imageID,
      target: 1, task: 'semantic', personalPreference: false, partition: 'evaluation-only' });
  }
}
assert.equal(seen.size, 60); assert.equal(predictions.size, 60); assert.equal(photos.size, 60);
assert.equal(new Set(observations.map(row => row.imageSha256)).size, 60);
const eligible = observations.filter(row => row.label !== null);
const oldRows = Array.isArray(older) ? older : older.predictions;
assert.equal(oldRows.length, 86);
for (const row of oldRows) assert.ok(finiteVector(row.imageEmbedding));
const calibrationCases = JSON.parse(await readFile(resolve(root, 'tests/fixtures/image-pretraining-v2/cases.json'), 'utf8'));
const calibrationHashes = new Set(calibrationCases.cases.flatMap(row => row.candidates.map(photo => photo.sha256)));
const oldHashes = new Set(oldRows.map(row => row.sourceSha256));
const report = {
  purpose: 'Replay fixed .19/.20 operating point; independent semantic labels, no training or threshold tuning.',
  frozenPolicy: policy,
  oldKeylessUi: metrics(oldRows),
  freshConfiguredPexelsUi: {
    observed: observations.length, galleries: primary.galleries.length,
    excludedUncertainOrDisagreed: observations.length - eligible.length,
    consensus: metrics(eligible), derivedClarityComparisons: comparisons.length,
    consensusExcludingOldUiPhotoHashes: metrics(eligible.filter(row => !oldHashes.has(row.imageSha256))),
    perGallery: primary.galleries.map(gallery => ({ galleryId: gallery.galleryId, word: gallery.word,
      ...metrics(eligible.filter(row => row.galleryId === gallery.galleryId)) }))
  },
  integrity: { uniqueReviewedPixelHashes: 60, completeImageAndMeaningVectors: 60, rawCosinesReplayed: 60,
    photosAlsoInThresholdCalibrationCorpus: observations.filter(row => calibrationHashes.has(row.imageSha256)).length,
    photosAlsoInOldKeylessUi: observations.filter(row => oldHashes.has(row.imageSha256)).length },
  limitations: ['Agent judgments are semantic clarity labels, not the user’s personal taste.',
    'Eight gallery groups are too few to establish stable general performance.',
    'This pre-filter UI collection contains Pexels and existing public-catalog fallback images.',
    'Evaluation examples and uncertain observations have not been added to model training.']
};
if (process.argv[2]) await writeFile(resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
