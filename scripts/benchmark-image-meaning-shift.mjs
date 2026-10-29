// Offline paired benchmark. Never activates a generic or personal app model.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark, validateSemanticSupervision } from './lib/image-pretraining-benchmark.mjs';
import { auditMeaningShiftSplit, pairedShiftDifference, shiftMetrics } from './lib/image-meaning-shift.mjs';
import { createPersonalizer, fitImagePersonalizer } from '../js/services/imagePersonalizer.js';
import { IMAGE_TRAINING_RECIPE } from '../js/ml/imageTrainingRecipe.js';

const args = process.argv.slice(2), flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const directory = flag('output-dir') || 'work/meaning-shift/results'; await mkdir(directory, { recursive: true });
const read = path => readJsonFile(path), sha = value => createHash('sha256').update(value).digest('hex');
const serialize = value => JSON.stringify(value, (_key, v) => ArrayBuffer.isView(v) ? Array.from(v) : v, 2) + '\n';
const save = (name, value) => writeFile(`${directory}/${name}`, serialize(value));
const log = (phase, detail) => process.stderr.write(JSON.stringify({ phase, ...detail }) + '\n');
const protocolPath = 'docs/image-meaning-shift-protocol.json', protocol = await read(protocolPath);
const plan = await read(protocol.split), manifest = await read(plan.sourceManifest), encoded = await read(plan.sourceFeatures);
for (const file of plan.preservation) if (sha(await readFile(file.path)) !== file.sha256) throw Error(`Original dataset changed: ${file.path}`);
validateSemanticSupervision(encoded, manifest); const original = validatePretrainingBenchmark(encoded, manifest);
const audits = Object.fromEntries(['seen', 'unseen'].map(arm => [arm, auditMeaningShiftSplit(original, plan, arm)]));
const provenance = { protocolSha256: sha(await readFile(protocolPath)), splitSha256: sha(await readFile(protocol.split)),
  recipe: IMAGE_TRAINING_RECIPE, recipeSha256: sha(JSON.stringify(IMAGE_TRAINING_RECIPE)), encoder: encoded.encoder,
  numericalSourceSha256: sha(await readFile('js/services/imagePersonalizer.js')), originalDataPreserved: true };
const modelHash = model => { const bytes = Buffer.alloc(model.weights.length * 4); model.weights.forEach((value, i) => bytes.writeFloatLE(value, i * 4)); return sha(bytes); };

if (args.includes('--aggregate')) {
  const runs = [];
  // Every arm's weights/checkpoints must already be frozen before any test use.
  for (const seed of protocol.seeds) for (const arm of ['seen', 'unseen']) {
    const run = await read(`${directory}/${seed}-${arm}.json.gz`);
    for (const key of ['protocolSha256', 'splitSha256', 'recipeSha256', 'numericalSourceSha256']) if (run.provenance[key] !== provenance[key]) throw Error(`Stale run ${seed}/${arm}: ${key}`);
    if (run.selectedWeightsSha256 !== modelHash(run.selected) || run.lastWeightsSha256 !== modelHash(run.last)) throw Error('Saved weights changed');
    runs.push(run);
  }
  const cases = original.cases, baseline = Object.fromEntries(['train', 'validation', 'test'].map(name => [name,
    name === 'train' ? Object.fromEntries(['seen', 'unseen'].map(arm => [arm, shiftMetrics(null, audits[arm].split.train, cases)])) : shiftMetrics(null, audits.seen.split[name], cases)]));
  for (const run of runs) {
    const audit = audits[run.arm];
    run.metrics = Object.fromEntries(['train', 'validation', 'test'].map(name => [name, {
      selected: shiftMetrics(run.selected, audit.split[name], cases), last: shiftMetrics(run.last, audit.split[name], cases) }]));
    delete run.selected; delete run.last;
  }
  const perSeed = protocol.seeds.map(seed => {
    const seen = runs.find(r => r.seed === seed && r.arm === 'seen'), unseen = runs.find(r => r.seed === seed && r.arm === 'unseen');
    return { seed, selected: pairedShiftDifference(unseen.metrics.test.selected, seen.metrics.test.selected),
      last: pairedShiftDifference(unseen.metrics.test.last, seen.metrics.test.last),
      selectedSeenVsClip: pairedShiftDifference(baseline.test, seen.metrics.test.selected),
      selectedUnseenVsClip: pairedShiftDifference(baseline.test, unseen.metrics.test.selected) };
  });
  const averaged = (arm, checkpoint) => ({ rows: baseline.test.rows.map((row, i) => ({ ...row,
    chosenAt1: runs.filter(r => r.arm === arm).reduce((n, r) => n + r.metrics.test[checkpoint].rows[i].chosenAt1, 0) / protocol.seeds.length,
    loss: runs.filter(r => r.arm === arm).reduce((n, r) => n + r.metrics.test[checkpoint].rows[i].loss, 0) / protocol.seeds.length })) });
  const meanPaired = Object.fromEntries(['selected', 'last'].map(checkpoint => {
    const value = pairedShiftDifference(averaged('unseen', checkpoint), averaged('seen', checkpoint));
    // Averaged seed outcomes are fractional, so the binary discordance test is
    // not applicable; the whole-meaning bootstrap remains the reported interval.
    value.exactDiscordanceP = null; value.zeroDiscordanceUpper95 = null; value.noObservedDiscordance = null;
    value.inferenceLevel = 'Mean per-meaning correctness across seeds; potentially fractional outcomes.';
    value.noObservedAverageOutcomeDifference = value.improved === 0 && value.worsened === 0;
    value.zeroDiscordanceCaveat = 'Binary discordance fields are null for seed averages. Per-seed binary bounds are in perSeed[].selected/last.zeroDiscordanceUpper95; the same meanings are reused, not pooled as independent seed examples.';
    value.note += ' Seed-averaged predictions; no pooled-seed independence or binary sign-test claim.';
    return [checkpoint, value];
  }));
  const report = { ...provenance, protocol, summary: { seen: audits.seen.summary, unseen: audits.unseen.summary },
    baseline, runs, perSeed, meanPaired, activated: false, originalDataPreserved: true,
    sourceMeanings: plan.retainedTargets, excludedTargets: plan.excludedTargets.length,
    testUse: 'All six fits, checkpoints and hashes frozen before aggregate test scoring. All test galleries identical across arms/seeds.' };
  await save('report.json', report); log('complete', { meanPaired, testClip: baseline.test.chosenAt1, testGalleries: baseline.test.choices });
  process.exit(0);
}

const seed = Number(flag('seed')); if (!protocol.seeds.includes(seed)) throw Error('Use a protocol seed or --aggregate');
for (const arm of ['seen', 'unseen']) {
  const { split, cases } = audits[arm], curve = []; let selected, selectedEpoch = 0, bestMatches = -1, bestLoss = Infinity;
  const fitted = fitImagePersonalizer({ ...createPersonalizer(seed), role: 'semantic' }, split.train, split.validation, {
    ...IMAGE_TRAINING_RECIPE, observeEpoch: (model, state) => {
      const train = shiftMetrics(model, split.train, cases), validation = shiftMetrics(model, split.validation, cases);
      const { rows: _tr, ...trainSummary } = train, { rows: _va, ...validationSummary } = validation;
      curve.push({ ...state, train: trainSummary, validation: validationSummary });
      if (validation.chosenAt1 > bestMatches || validation.chosenAt1 === bestMatches && validation.loss < bestLoss - 1e-12) {
        selected = { ...model, weights: Float32Array.from(model.weights) }; selectedEpoch = state.epoch;
        bestMatches = validation.chosenAt1; bestLoss = validation.loss;
      }
      if (state.epoch % 10 === 0) log('epoch', { seed, arm, epoch: state.epoch, trainLoss: train.loss, validationCorrect: validation.chosenAt1, validationLoss: validation.loss });
    }
  });
  const result = { provenance, seed, arm, selected, last: fitted.model, selectedEpoch, curve,
    selectedWeightsSha256: modelHash(selected), lastWeightsSha256: modelHash(fitted.model),
    epochsRun: fitted.epochsRun, steps: fitted.steps, stoppedBy: fitted.stoppedBy, elapsedMs: fitted.elapsedMs,
    maximumObservedGradientNorm: fitted.maximumObservedGradientNorm, clippedSteps: fitted.clippedSteps, testEvaluated: false };
  await writeFile(`${directory}/${seed}-${arm}.json.gz`, gzipSync(serialize(result)));
  log('fit-complete', { seed, arm, selectedEpoch, epochsRun: fitted.epochsRun, testEvaluated: false });
}
