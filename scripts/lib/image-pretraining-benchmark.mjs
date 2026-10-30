// Offline-only benchmark utilities. None of these functions activate an app model.
import { cosine, decodeFeatures, normalizedVector, sigmoid } from '../../js/services/imagePreferences.js';
import { CLIP_TAG } from '../../js/ml/clipConfig.js';
import { IMAGE_PREPROCESSING, activeImageExamples, splitImageDecisions, semanticDatasetPartitions, evaluatePersonalizer,
  personalizerScore, validPersonalizer } from '../../js/services/imagePersonalizer.js';
import { PERSONALIZER_VERSION as V2_PERSONALIZER_VERSION, LEGACY_PERSONALIZER_VERSION as V2_LEGACY_VERSION, validPersonalizer as validV2Personalizer,
  personalizerScore as v2PersonalizerScore, evaluatePersonalizer as evaluateV2Personalizer } from './image-personalizer-v2.mjs';

const partitions = ['train', 'validation', 'test'];
const normalized = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function modelValid(model) {
  return [V2_PERSONALIZER_VERSION, V2_LEGACY_VERSION].includes(model?.version) ? validV2Personalizer(model) : validPersonalizer(model);
}
function modelScore(model, features, meaningFeatures) {
  return [V2_PERSONALIZER_VERSION, V2_LEGACY_VERSION].includes(model?.version)
    ? v2PersonalizerScore(model, features, meaningFeatures)
    : personalizerScore(model, features, meaningFeatures);
}
function photoUrl(value) {
  try { const url = new URL(value); url.hash = ''; url.search = ''; return url.href; }
  catch { throw new Error(`A source photo URL is missing or invalid: ${value || '(empty)'}`); }
}
function ownedSplit(owners, value, split, label) {
  requireCondition(!owners.has(value) || owners.get(value) === split, `${label} appears in both ${owners.get(value)} and ${split}.`);
  owners.set(value, split);
}

/** Generic correctness labels cannot silently inherit ordinary personal choices. */
export function validateSemanticSupervision(encoded, manifest) {
  requireCondition(manifest?.targetTask === 'semantic' && Array.isArray(encoded?.events)
    && encoded.events.length > 0 && encoded.events.every(event => event.task === 'semantic'),
    'Generic correctness pretraining requires manifest targetTask: semantic and explicitly semantic events; personal preferences must stay separate.');
  requireCondition(!encoded.targetTask || encoded.targetTask === 'semantic', 'Encoded report declares a different learning task.');
  for (const item of manifest.cases || []) {
    const selected = new Set(item.feedback?.selected || []), wrong = new Set(item.feedback?.wrong || []);
    requireCondition((item.candidates || []).every(photo => selected.has(photo.id) || wrong.has(photo.id)),
      `Semantic case ${item.id} has an ambiguous alternative; each compared alternative must be explicitly labeled wrong for the target meaning.`);
  }
}

/** Validate supplied partitions before the trainer or the test labels are used. */
export function validatePretrainingBenchmark(encoded, manifest) {
  requireCondition(Array.isArray(manifest?.cases) && manifest.cases.length, 'Manifest cases are required.');
  requireCondition(Array.isArray(encoded?.events) && encoded.events.length, 'Encoded training events are required.');
  requireCondition(encoded.encoder === CLIP_TAG && encoded.preprocessing === IMAGE_PREPROCESSING,
    'Encoded dataset uses an unsupported encoder or preprocessing version.');
  const cases = new Map(), meaningOwners = new Map(), familyOwners = new Map(), targetOwners = new Map(), photoOwners = new Map();
  const bySplit = Object.fromEntries(partitions.map(split => [split, []]));
  for (const item of manifest.cases) {
    requireCondition(typeof item.id === 'string' && item.id && !cases.has(item.id), 'Manifest case IDs must be unique non-empty strings.');
    requireCondition(partitions.includes(item.split), `Case ${item.id} has no explicit train/validation/test split.`);
    requireCondition(typeof item.meaningId === 'string' && item.meaningId, `Case ${item.id} has no meaningId.`);
    requireCondition(normalized(item.word?.word) && normalized(item.word?.definition), `Case ${item.id} requires a word and definition.`);
    ownedSplit(meaningOwners, item.meaningId, item.split, `Meaning ${item.meaningId}`);
    if (item.familyId) ownedSplit(familyOwners, String(item.familyId), item.split, `Meaning family ${item.familyId}`);
    ownedSplit(targetOwners, JSON.stringify([normalized(item.word.word), normalized(item.word.partOfSpeech), normalized(item.word.definition)]), item.split, `Target meaning in ${item.id}`);
    requireCondition(Array.isArray(item.candidates) && item.candidates.length >= 2, `Case ${item.id} requires at least two source photos.`);
    const photos = new Map();
    for (const photo of item.candidates) {
      requireCondition(typeof photo.id === 'string' && photo.id && !photos.has(photo.id), `Case ${item.id} has missing or duplicate source photo IDs.`);
      requireCondition(typeof photo.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(photo.sha256), `Photo ${photo.id} requires a SHA-256 hash.`);
      const source = photoUrl(photo.url), hash = photo.sha256.toLowerCase();
      for (const identity of [`id:${photo.id}`, `hash:${hash}`, `url:${source}`,
        ...(photo.sourceUrl ? [`source:${photoUrl(photo.sourceUrl)}`] : []),
        ...(photo.duplicateGroup ? [`duplicate:${photo.duplicateGroup}`] : [])]) {
        ownedSplit(photoOwners, identity, item.split, `Source photo ${identity}`);
      }
      requireCondition(![...photos.values()].some(other => other.sha256.toLowerCase() === hash || photoUrl(other.url) === source), `Case ${item.id} repeats the same source photo.`);
      photos.set(photo.id, photo);
    }
    // The encoder report currently retains only the first selected reference.
    // Reject a multi-reference fixture rather than inventing scores for it.
    requireCondition(Array.isArray(item.feedback?.selected) && item.feedback.selected.length === 1,
      `Case ${item.id} needs exactly one preferred reference for this encoded comparison benchmark.`);
    const selected = item.feedback.selected[0];
    requireCondition(photos.has(selected), `Case ${item.id} selects a missing source photo.`);
    requireCondition((item.feedback.wrong || []).every(id => photos.has(id) && id !== selected), `Case ${item.id} has invalid wrong-photo feedback.`);
    cases.set(item.id, { ...item, photos, reference: selected, records: [], features: new Map() });
    bySplit[item.split].push(item.id);
  }
  for (const name of partitions) requireCondition(bySplit[name].length, `Manifest ${name} partition is empty.`);
  const eventIds = new Set();
  for (const event of encoded.events) {
    requireCondition(event?.id && !eventIds.has(event.id), 'Encoded event IDs must be unique.'); eventIds.add(event.id);
    const item = cases.get(event.decisionId);
    requireCondition(item, `Encoded event ${event.id} does not belong to a manifest case.`);
    requireCondition(event.kind === 'comparison', `Encoded event ${event.id} is not a relative comparison.`);
    requireCondition(event.meaningId === item.meaningId, `Encoded event ${event.id} has a different target meaning.`);
    requireCondition(event.encoder === encoded.encoder && event.preprocessing === encoded.preprocessing, `Encoded event ${event.id} has incompatible features.`);
    requireCondition(!event.context?.word || normalized(event.context.word) === normalized(item.word.word), `Encoded event ${event.id} has a different word.`);
    requireCondition(!event.context?.definition || normalized(event.context.definition) === normalized(item.word.definition), `Encoded event ${event.id} has a different definition.`);
    const reference = item.photos.get(item.reference);
    const alternative = [...item.photos.values()].find(photo => photo.url === event.context?.imageUrl);
    requireCondition(reference.url === event.context?.preferredUrl && alternative && alternative.id !== reference.id,
      `Encoded event ${event.id} does not compare the manifest's preferred and alternative source photos.`);
    requireCondition(!item.features.has(alternative.id), `Case ${item.id} repeats an encoded comparison.`);
    requireCondition(!item.features.has(reference.id) || item.features.get(reference.id) === event.preferredFeatures,
      `Case ${item.id} has conflicting reference features.`);
    requireCondition(!item.meaningFeatures || item.meaningFeatures === event.meaningFeatures,
      `Case ${item.id} has conflicting meaning features.`);
    item.features.set(reference.id, event.preferredFeatures); item.features.set(alternative.id, event.features);
    item.meaningFeatures = event.meaningFeatures; item.records.push(event);
  }
  requireCondition(activeImageExamples(encoded.events).length === encoded.events.length,
    'Some encoded events are malformed, unsupported, or superseded; benchmark records must all be active.');
  for (const item of cases.values()) requireCondition(item.features.size === item.photos.size,
    `Case ${item.id} is missing encoded source photos or comparisons.`);
  const datasetPartitions = manifest.targetTask === 'semantic' ? bySplit : null;
  const actual = datasetPartitions ? semanticDatasetPartitions(encoded.events, datasetPartitions) : splitImageDecisions(encoded.events);
  for (const name of partitions) {
    const expected = [...bySplit[name]].sort(), seen = actual[name].map(decision => decision.id).sort();
    requireCondition(JSON.stringify(expected) === JSON.stringify(seen),
      `Manifest ${name} partition does not match splitImageDecisions; timestamps/meaning ordering must match the declared split.`);
  }
  const diversity = Object.fromEntries(partitions.map(split => {
    const rows = bySplit[split].map(id => cases.get(id));
    return [split, { choices: rows.length, meanings: new Set(rows.map(row => row.meaningId)).size, families: new Set(rows.map(row => row.familyId || row.meaningId)).size,
      sourcePhotos: new Set(rows.flatMap(row => [...row.photos.values()].map(photo => photo.sha256.toLowerCase()))).size,
      candidateCounts: [...new Set(rows.map(row => row.photos.size))].sort((a, b) => a - b),
      preferredPositions: rows.reduce((counts, row) => { const index = row.candidates.findIndex(photo => photo.id === row.reference); counts[index] = (counts[index] || 0) + 1; return counts; }, {}) }];
  }));
  return { cases, split: actual, diversity, datasetPartitions };
}

function rawClipScore(features, meaningFeatures) {
  return cosine(normalizedVector(decodeFeatures(features).slice(0,512)), normalizedVector(decodeFeatures(meaningFeatures).slice(0,512)));
}
function evaluateRawClip(decisions) {
  const rows=decisions.map(decision=>{
    const pairs=decision.records.filter(record=>record.kind==='comparison');let loss=0,accuracy=0;
    for(const row of pairs){const difference=rawClipScore(row.preferredFeatures,row.meaningFeatures)-rawClipScore(row.features,row.meaningFeatures);
      loss-=Math.log(Math.max(1e-8,sigmoid(difference*8)))/pairs.length;accuracy+=Number(difference>0)/pairs.length;}
    return {id:decision.id,meaningId:decision.meaningId,loss,accuracy,eligible:pairs.length>0};
  }).filter(row=>row.eligible);
  return {rows,loss:rows.length?rows.reduce((sum,row)=>sum+row.loss,0)/rows.length:null,
    accuracy:rows.length?rows.reduce((sum,row)=>sum+row.accuracy,0)/rows.length:null};
}
function choiceResults(model, decisions, cases, rawClip = false) {
  return decisions.map(decision => {
    const item = cases.get(decision.id), scored = item.candidates.map((photo, index) => ({ id: photo.id, index,
      score: rawClip ? rawClipScore(item.features.get(photo.id), item.meaningFeatures) : modelScore(model, item.features.get(photo.id), item.meaningFeatures) }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const topScore = scored[0].score, tied = scored.filter(row => row.score === topScore);
    return { id: item.id, meaningId: item.meaningId, familyId: item.familyId || null, domain: item.domain || 'unspecified', preferredPosition: item.candidates.findIndex(photo => photo.id === item.reference), candidateCount: item.candidates.length, topPhotoId: scored[0].id,
      chosenAt1: Number(scored[0].id === item.reference), tiedAt1: tied.length > 1,
      fractionalTieCredit: tied.some(row => row.id === item.reference) ? 1 / tied.length : 0,
      explicitlyWrongAt1: Number((item.feedback.wrong || []).includes(scored[0].id)) };
  });
}
function summarize(model, decisions, cases, rawClip = false) {
  const legacy = [V2_PERSONALIZER_VERSION, V2_LEGACY_VERSION].includes(model?.version);
  const metric = rawClip ? evaluateRawClip(decisions) : legacy ? evaluateV2Personalizer(model, decisions) : evaluatePersonalizer(model, decisions), choiceRows = choiceResults(model, decisions, cases, rawClip);
  return { choices: choiceRows.length, meanPairwiseLoss: metric.loss, pairwiseAgreement: metric.accuracy,
    chosenAt1: choiceRows.reduce((n, row) => n + row.chosenAt1, 0), chosenAt1Rate: choiceRows.length ? choiceRows.reduce((n, row) => n + row.chosenAt1, 0) / choiceRows.length : null,
    tiedAt1: choiceRows.filter(row => row.tiedAt1).length, tieAwareAgreement: choiceRows.length ? choiceRows.reduce((n, row) => n + row.fractionalTieCredit, 0) / choiceRows.length : null,
    explicitlyWrongAt1: choiceRows.reduce((n, row) => n + row.explicitlyWrongAt1, 0), rows: metric.rows.map((row, index) => ({ ...row, ...choiceRows[index] })) };
}

/** Paired differences resample whole meanings; correlated galleries stay together. */
export function pairedMeaningBootstrap(before, after, { bootstrapSamples = 1000, seed = 81273, groupByFamily = false } = {}) {
  requireCondition(before.rows.length === after.rows.length, 'Paired reports must contain the same choices.');
  requireCondition(Number.isInteger(bootstrapSamples) && bootstrapSamples > 0, 'Positive bootstrapSamples is required.');
  const groups = new Map();
  before.rows.forEach((row, index) => {
    const candidate = after.rows[index]; requireCondition(candidate.id === row.id && candidate.meaningId === row.meaningId, 'Paired report ordering does not match.');
    const groupId = groupByFamily ? row.familyId || row.meaningId : row.meaningId;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push({ loss: row.loss - candidate.loss, agreement: candidate.accuracy - row.accuracy,
      firstChoice: candidate.chosenAt1 - row.chosenAt1, tieAware: candidate.fractionalTieCredit - row.fractionalTieCredit });
  });
  const means = [...groups.values()].map(rows => Object.fromEntries(['loss', 'agreement', 'firstChoice', 'tieAware'].map(key => [key, rows.reduce((sum, row) => sum + row[key], 0) / rows.length])));
  const result = { unit: groupByFamily ? 'meaning-family' : 'meaning', meaningCount: means.length, confidence: .95, bootstrapSamples, positiveDifferenceFavors: 'MLP', metrics: {} };
  for (const key of ['loss', 'agreement', 'firstChoice', 'tieAware']) {
    const estimate = means.length ? means.reduce((sum, row) => sum + row[key], 0) / means.length : null, samples = [];
    if (means.length > 1) for (let b = 0; b < bootstrapSamples; b++) {
      let sum = 0; for (let index = 0; index < means.length; index++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; sum += means[(seed >>> 0) % means.length][key]; }
      samples.push(sum / means.length);
    }
    samples.sort((a, b) => a - b);
    result.metrics[key] = { meanDifference: estimate, lower: samples.length ? samples[Math.floor(samples.length * .025)] : null,
      upper: samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * .975))] : null };
  }
  return result;
}

export function comparePretrainingModels(validated, candidate, options = {}) {
  requireCondition(modelValid(candidate), 'Candidate model is invalid.');
  return Object.fromEntries(partitions.map(name => {
    const rawClip = summarize(null, validated.split[name], validated.cases, true),
      baseline = summarize(null, validated.split[name], validated.cases), mlp = summarize(candidate, validated.split[name], validated.cases);
    return [name, { rawClip, baseline, mlp, pairedMeaningBootstrap: pairedMeaningBootstrap(baseline, mlp, { ...options, groupByFamily: true }),
      rawClipVsMlpMeaningBootstrap: pairedMeaningBootstrap(rawClip, mlp, { ...options, groupByFamily: true }) }];
  }));
}
