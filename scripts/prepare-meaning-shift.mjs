import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark, validateSemanticSupervision } from './lib/image-pretraining-benchmark.mjs';
import { auditMeaningShiftSplit } from './lib/image-meaning-shift.mjs';

const directory = process.argv[2] || 'tests/fixtures/image-meaning-shift';
await mkdir(`${directory}/audit`, { recursive: true });
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const manifestPath = 'tests/fixtures/image-pretraining-v2/cases.json';
const encodedPath = 'tests/fixtures/image-pretraining-fp16/embeddings.json.gz';
const manifest = await read(manifestPath), encoded = await readJsonFile(encodedPath);
validateSemanticSupervision(encoded, manifest);
const validated = validatePretrainingBenchmark(encoded, manifest);
const proposal = await read('work/same-meaning-audit/matched-proposal.json');
const files = ['review/luna.json', 'review/terra.json', 'review/root-spotcheck.json', 'exposure-review/luna.json', 'exposure-review/terra.json', 'control-review/luna.json', 'control-review/terra.json'];
const expectedHeldout = new Set([...proposal.validationIds, ...proposal.testIds]), primary = new Set();
const targetForControl = new Map(proposal.pairs.map(pair => [pair.unseenId, pair.meaningId]));
const bad = new Map();
for (const file of files) {
  const data = await read(`work/meaning-shift/${file}`);
  for (const row of data.reviews) {
    const item = validated.cases.get(row.id);
    if (!item) throw Error(`Unknown reviewed case ${row.id}`);
    const classified = ['fits', 'wrong', 'uncertain'].flatMap(key => row[key]);
    const expected = item.candidates.map(photo => photo.id).sort();
    if (new Set(classified).size !== classified.length || JSON.stringify([...classified].sort()) !== JSON.stringify(expected)) throw Error(`Incomplete review ${row.id}`);
    if (file.startsWith('review/') && !file.includes('spotcheck')) {
      if (primary.has(row.id)) throw Error('Duplicate primary review'); primary.add(row.id);
    }
    if (row.fits.length !== 1 || row.fits[0] !== item.reference || row.uncertain.length) {
      const meaningId = file.startsWith('control-') ? targetForControl.get(row.id) : item.meaningId;
      if (!meaningId) throw Error('Unknown matched control review');
      if (!bad.has(meaningId)) bad.set(meaningId, []);
      bad.get(meaningId).push({ caseId: row.id, review: file, note: row.note, fits: row.fits, uncertain: row.uncertain });
    }
  }
  await copyFile(`work/meaning-shift/${file}`, `${directory}/audit/${file.replaceAll('/', '-')}`);
}
if (primary.size !== expectedHeldout.size || [...expectedHeldout].some(id => !primary.has(id))) throw Error('Blind heldout review coverage mismatch');
const retained = proposal.pairs.filter(pair => !bad.has(pair.meaningId));
const targets = new Set(retained.map(row => row.meaningId));
const plan = { version: 1, kind: 'same-meaning-photo-disjoint-controlled-regression',
  sourceManifest: manifestPath, sourceFeatures: encodedPath, originalSplitPreserved: true,
  construction: proposal.method, allocationSeed: 1573, allocationAttempts: 3000,
  reviewRule: 'Keep a whole target triple and its matched control only when every reviewed gallery has exactly the original single reference fitting, every other photo wrong, and no uncertain labels. Any disagreement excludes the target triple and its matched control exposure; no vote or relabeling. No model outcomes used.',
  validationIds: proposal.validationIds.filter(id => targets.has(validated.cases.get(id).meaningId)),
  testIds: proposal.testIds.filter(id => targets.has(validated.cases.get(id).meaningId)),
  commonIds: proposal.commonIds,
  seenExposureIds: retained.map(row => row.seenId), unseenExposureIds: retained.map(row => row.unseenId),
  pairs: retained, excludedTargets: [...bad].map(([meaningId, reasons]) => ({ meaningId, reasons })),
  primaryReviewedHeldoutGalleries: primary.size,
  candidateTargets: proposal.pairs.length, retainedTargets: retained.length,
  alternateAllocation: { targets: 78, trainingGalleries: 79, backgroundGalleries: 1, domainMismatches: 17,
    use: 'Rejected before fitting: larger heldout pool would sacrifice the common background and metadata matching.' } };
const exposureReviews = new Set((await Promise.all(files.filter(f => f.startsWith('exposure')).map(async file => (await read(`work/meaning-shift/${file}`)).reviews))).flat().map(row => row.id));
if (plan.seenExposureIds.some(id => !exposureReviews.has(id))) throw Error('Missing seen exposure review');
const controlReviews = new Set((await Promise.all(files.filter(f => f.startsWith('control')).map(async file => (await read(`work/meaning-shift/${file}`)).reviews))).flat().map(row => row.id));
if (plan.unseenExposureIds.some(id => !controlReviews.has(id))) throw Error('Missing matched control review');
plan.summary = Object.fromEntries(['seen', 'unseen'].map(arm => [arm, auditMeaningShiftSplit(validated, plan, arm).summary]));
const used = new Set([...plan.commonIds, ...plan.seenExposureIds, ...plan.unseenExposureIds, ...plan.validationIds, ...plan.testIds]);
plan.preservedOutsideExperimentIds = [...validated.cases.keys()].filter(id => !used.has(id));
plan.preservation = await Promise.all([manifestPath, encodedPath, 'tests/fixtures/image-pretraining-v2/embeddings.json.gz'].map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
await save(`${directory}/split.json`, plan);
await copyFile('work/same-meaning-audit/proposal.json', `${directory}/audit/allocation-proposal.json`);
await copyFile('work/same-meaning-audit/matched-proposal.json', `${directory}/audit/matched-proposal.json`);
await copyFile('work/meaning-shift/source-audit.json', `${directory}/audit/source-audit.json`);
await copyFile('work/meaning-shift/review/blind-index.json', `${directory}/audit/heldout-blind-index.json`);
await copyFile('work/meaning-shift/exposure-review/blind-index.json', `${directory}/audit/exposure-blind-index.json`);
await copyFile('work/meaning-shift/control-review/blind-index.json', `${directory}/audit/control-blind-index.json`);
console.log(JSON.stringify({ targets: plan.retainedTargets, excludedTargets: bad.size, summary: plan.summary, preservedOutsideExperiment: plan.preservedOutsideExperimentIds.length }, null, 2));
