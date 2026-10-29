// Reproducible offline diagnostics using the same numerical fitter as the app.
// It saves a candidate, never authorizes its activation or labels semantic data as taste.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readJsonFile } from './lib/json-files.mjs';
import { validatePretrainingBenchmark, validateSemanticSupervision, comparePretrainingModels } from './lib/image-pretraining-benchmark.mjs';
import { trainingMetrics, residualCapacity, gradientDiagnostic, fixedLabelBiasVariance } from './lib/image-training-diagnostics.mjs';
import { createPersonalizer, trainImagePersonalizer, fitImagePersonalizer, PERSONALIZER_FIT_DEFAULTS } from '../js/services/imagePersonalizer.js';
import { CLIP_TAG } from '../js/ml/clipConfig.js';

const args = process.argv.slice(2), file = args.find(value => !value.startsWith('--'));
const flag = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!file || !flag('manifest')) throw Error('Usage: node scripts/retrain-image-personalizer.mjs encoded.json --manifest=cases.json --output-dir=work/experiment [--protocol=protocol.json]');
const directory = resolve(flag('output-dir') || 'work/mlp-fp16-retrain/results');
await mkdir(directory, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const serialize = value => JSON.stringify(value, (_key, item) => ArrayBuffer.isView(item) ? Array.from(item) : item, 2) + '\n';
const save = async (name, value) => writeFile(resolve(directory, name), serialize(value));
const compressed = async (name, value) => writeFile(resolve(directory, name), gzipSync(serialize(value)));
const log = (phase, detail = {}) => process.stderr.write(JSON.stringify({ phase, ...detail }) + '\n');
const protocolText = await readFile(flag('protocol') || 'docs/image-mlp-fp16-protocol.json', 'utf8'), protocol = JSON.parse(protocolText);
if (protocol.encoder !== CLIP_TAG || protocol.training.learningRate !== PERSONALIZER_FIT_DEFAULTS.learningRate
  || protocol.training.regularization !== PERSONALIZER_FIT_DEFAULTS.regularization) throw Error('Protocol does not describe the current production fitter.');
const encoded = await readJsonFile(file), manifestText = await readFile(flag('manifest'), 'utf8'), manifest = JSON.parse(manifestText);
validateSemanticSupervision(encoded, manifest);
const validated = validatePretrainingBenchmark(encoded, manifest), { split, cases } = validated;
const sourceFiles = ['js/services/imagePersonalizer.js', 'scripts/retrain-image-personalizer.mjs', 'scripts/lib/image-training-diagnostics.mjs'];
const provenance = { encoder: CLIP_TAG, targetTask: 'semantic', protocolSha256: sha(protocolText), manifestSha256: sha(manifestText),
  eventsSha256: sha(JSON.stringify(encoded.events)), nodeVersion: process.version,
  sourceSha256: Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, sha(await readFile(name))]))),
  comparisons: encoded.events.length, diversity: validated.diversity };
await save('provenance.json', provenance); await save('protocol.json', protocol);

const checkpoints = [], curves = [];
log('training-start', { comparisons: encoded.events.length });
const result = trainImagePersonalizer(encoded.events, null, { ...protocol.training, task: 'semantic', datasetPartitions: validated.datasetPartitions, returnCandidate: true,
  initialization: { ...createPersonalizer(protocol.initializationSeed), role: 'semantic' },
  observeEpoch: (model, state) => {
    checkpoints.push({ ...state, weights: Float32Array.from(model.weights) });
    const row = { ...state, train: trainingMetrics(model, split.train, cases), validation: trainingMetrics(model, split.validation, cases) };
    curves.push(row); log('epoch', { epoch: state.epoch, trainLoss: row.train.loss, validationLoss: state.validationLoss });
  } });
const candidate = result.model || result.candidate;
if (!candidate) throw Error(result.reason || 'No candidate produced.');
const selectedEpoch = curves.at(-1).selectedEpoch;
// Test labels cannot affect optimization, checkpoint selection or stopping.
for (let i = 0; i < checkpoints.length; i++) curves[i].test = trainingMetrics({ ...candidate, weights: checkpoints[i].weights }, split.test, cases);
const comparison = comparePretrainingModels(validated, candidate, { bootstrapSamples: 2000 });
const finalMetrics = Object.fromEntries(['train','validation','test'].map(name => [name, {
  baseline: trainingMetrics(null, split[name], cases), mlp: trainingMetrics(candidate, split[name], cases),
  capacity: residualCapacity(split[name], cases)
}]));
for (const value of Object.values(finalMetrics)) delete value.capacity.rows;
const weightBytes = Buffer.alloc(candidate.weights.length * 4); candidate.weights.forEach((value, i) => weightBytes.writeFloatLE(value, i * 4));
const main = { ...provenance, protocol, selectedEpoch, epochsRun: curves.length - 1, curves, finalMetrics, comparison,
  candidateWeightsSha256: sha(weightBytes), appLossAcceptance: result.accepted,
  activated: false, activationReason: 'A previously inspected regression set is not a new blind acceptance set; candidate saved for inspection.',
  testCurveUse: 'Post-hoc diagnostic only; all checkpoints selected and optimization stopped before test trajectories were calculated.' };
await save('training-report.json', main);
await compressed('candidate.json.gz', { model: candidate, candidateWeightsSha256: sha(weightBytes), activated: false, protocol });
await compressed('checkpoints.json.gz', checkpoints);
log('training-complete', { selectedEpoch, epochsRun: main.epochsRun, finalMetrics });

const gradientModel = { ...createPersonalizer(protocol.initializationSeed), role: 'semantic' };
for (let i = 49808; i < gradientModel.weights.length; i++) gradientModel.weights[i] = .05 * Math.sin(i);
const gradient = gradientDiagnostic(gradientModel, split.train.slice(0,8));
await save('gradient-check.json', gradient);
if (!gradient.passed) throw Error('Finite-difference backpropagation check failed.');

const baseline = trainingMetrics(null, split.train, cases, { rows: true });
const correctable = new Set(residualCapacity(split.train, cases).rows.filter(row => row.allCorrectable).map(row => row.id));
const failures = new Set(baseline.rows.filter(row => !row.chosenAt1).map(row => row.id)), usedFamilies = new Set();
const tiny = [...split.train].sort((a,b)=>a.id.localeCompare(b.id)).filter(decision => {
  const family = cases.get(decision.id).familyId || decision.meaningId;
  if (!failures.has(decision.id) || !correctable.has(decision.id) || usedFamilies.has(family)) return false;
  usedFamilies.add(family); return true;
}).slice(0,protocol.smallBatch.galleries);
if (tiny.length !== protocol.smallBatch.galleries) throw Error('Not enough independent, theoretically correctable training mistakes for the predeclared overfit check.');
const tinyCurve = [], tinyStart = { ...createPersonalizer(protocol.initializationSeed), role: 'semantic' };
const tinyFit = fitImagePersonalizer(tinyStart, tiny, tiny, { ...protocol.training, ...protocol.smallBatch, patience: Infinity,
  observeEpoch: (model, state) => { tinyCurve.push({ ...state, ...trainingMetrics(model, tiny, cases) }); } });
const smallBatch = { decisionIds: tiny.map(row => row.id), comparisons: tiny.reduce((sum,row)=>sum+row.records.length,0),
  selection: protocol.smallBatch.selection, epochsRun: tinyFit.epochsRun, selectedEpoch: tinyFit.bestEpoch,
  before: tinyCurve[0], after: trainingMetrics(tinyFit.model, tiny, cases),
  capacity: residualCapacity(tiny, cases), curve: tinyCurve,
  passed: false, caveat: 'Training-only memorization check; training examples are deliberately reused for stopping diagnostics. This is not validation/test evidence or proof that the entire pipeline is correct.' };
smallBatch.passed = smallBatch.after.chosenAt1 === tiny.length && smallBatch.after.pairwiseAccuracy > 1 - 1e-12;
await save('small-batch-overfit.json', smallBatch);
log('overfit-complete', { passed: smallBatch.passed, before: smallBatch.before.chosenAt1, after: smallBatch.after.chosenAt1, loss: smallBatch.after.loss });
if (!smallBatch.passed) throw Error('Small-batch overfit check failed; inspect constraints/optimization before accepting the training pipeline.');

const families = new Map();
for (const decision of split.train) {
  const family = cases.get(decision.id).familyId || decision.meaningId;
  if (!families.has(family)) families.set(family, []);
  families.get(family).push(decision);
}
const groups = [...families.entries()], bootstrap = [], predictionRuns = [];
for (let repeat = 0; repeat < protocol.biasVariance.bootstrapModels; repeat++) {
  let seed = protocol.biasVariance.bootstrapSeed + repeat * 7919;
  const random = () => { seed = Math.imul(seed,1664525)+1013904223|0; return (seed>>>0)/4294967296; };
  const sampled = Array.from({length:groups.length},()=>groups[Math.floor(random()*groups.length)]), training = sampled.flatMap(([,decisions])=>decisions);
  const fitted = fitImagePersonalizer({ ...createPersonalizer(protocol.initializationSeed), role:'semantic' }, training, split.validation, protocol.training);
  const evaluated = trainingMetrics(fitted.model, split.test, cases, { predictions:true });
  predictionRuns.push(evaluated.probabilities);
  const {probabilities: _p, predictionWeights: _w, ...metrics} = evaluated;
  bootstrap.push({ repeat, sampledFamilies:sampled.map(([family])=>family), trainingGalleries:training.length,
    selectedEpoch:fitted.bestEpoch, epochsRun:fitted.epochsRun, elapsedMs:fitted.elapsedMs, metrics });
  await save('bootstrap-progress.json',{completed:bootstrap.length,total:protocol.biasVariance.bootstrapModels,bootstrap,predictionRuns});
  log('bootstrap', { completed:bootstrap.length,total:protocol.biasVariance.bootstrapModels,testMatches:evaluated.chosenAt1,epochsRun:fitted.epochsRun });
}
const reference = trainingMetrics(null,split.test,cases,{predictions:true});
const biasVariance = { ...fixedLabelBiasVariance(predictionRuns,reference.predictionWeights),
  protocol:protocol.biasVariance, trainingFamilies:groups.length, bootstrap, predictionRuns, predictionWeights:reference.predictionWeights,
  baselineBrier:reference.brier,candidateBrier:finalMetrics.test.mlp.brier,
  notes:['Training families are resampled; original validation and test examples never enter a fit.',
    'Initialization is fixed: this estimates variation from resampling training families, conditional on this dataset, validation set and algorithm.',
    'Distractor photos may be shared among training families; these family resamples do not capture every source-photo dependency.',
    'The empirical bias term includes score bounds and probability calibration effects; it is not an identifiable population/Bayes bias.'] };
await save('bias-variance.json',biasVariance);
console.log(serialize({selectedEpoch,finalMetrics,gradientPassed:gradient.passed,smallBatchPassed:smallBatch.passed,
  biasVariance:Object.fromEntries(Object.entries(biasVariance).filter(([key])=>!['bootstrap','predictionRuns','predictionWeights'].includes(key))),activated:false}));
