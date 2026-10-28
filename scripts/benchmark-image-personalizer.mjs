// One fixed offline experiment; this script never installs the resulting model.
import { readJsonFile } from './lib/json-files.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { trainImagePersonalizer } from '../js/services/imagePersonalizer.js';
import { validatePretrainingBenchmark, comparePretrainingModels, validateSemanticSupervision } from './lib/image-pretraining-benchmark.mjs';
const args = process.argv.slice(2), file = args.find(arg => !arg.startsWith('--'));
const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!file || !flag('manifest')) throw new Error('Usage: node scripts/benchmark-image-personalizer.mjs encoded-report.json --manifest=cases.json --output=report.json --candidate-output=candidate.json [--epochs=30]');
const encoded = await readJsonFile(file), manifestText = await readFile(flag('manifest'), 'utf8');
const manifest = JSON.parse(manifestText);
validateSemanticSupervision(encoded, manifest);
const validated = validatePretrainingBenchmark(encoded, manifest);
const epochs = Number(flag('epochs') || 30);
if (!Number.isInteger(epochs) || epochs < 1 || epochs > 100) throw new Error('--epochs must be a preselected integer between 1 and 100.');
const config = { task: 'semantic', datasetPartitions: validated.datasetPartitions, epochs, batchSize: 8, maxMilliseconds: 120000, outputOnly: false, returnCandidate: true };
const start = performance.now(), trainingTrace = [];
const result = trainImagePersonalizer(encoded.events, null, { ...config,
  progress: value => { trainingTrace.push(value); process.stderr.write(`${JSON.stringify(value)}\n`); } });
const candidate = result.model || result.candidate;
if (!candidate) throw new Error(result.reason || 'Training produced no candidate.');
const splits = comparePretrainingModels(validated, candidate), baseline = splits.test.baseline, mlp = splits.test.mlp;
const rawClipConclusion = mlp.chosenAt1 < splits.test.rawClip.chosenAt1 ? 'Raw CLIP cosine matched more held-out choices than CLIP plus MLP in this run.'
  : mlp.chosenAt1 === splits.test.rawClip.chosenAt1 ? 'CLIP plus MLP and raw CLIP cosine matched the same number of held-out choices.'
    : 'CLIP plus MLP matched more held-out choices than raw CLIP cosine in this run; inspect the paired uncertainty before inferring a reliable advantage.';
// Generic activation requires a first-choice advantage over both comparators,
// with a positive lower confidence bound. Fixed before the real-data run.
const accepted = Boolean(result.accepted && mlp.chosenAt1 > baseline.chosenAt1
  && mlp.chosenAt1 > splits.test.rawClip.chosenAt1
  && splits.test.pairedMeaningBootstrap.metrics.firstChoice.lower > 0
  && splits.test.rawClipVsMlpMeaningBootstrap.metrics.firstChoice.lower > 0);
const weightBytes = Buffer.alloc(candidate.weights.length * 4); Float32Array.from(candidate.weights).forEach((value, i) => weightBytes.writeFloatLE(value, i * 4));
const candidateWeightsSha256 = createHash('sha256').update(weightBytes).digest('hex');
const domainResults = Object.fromEntries(Object.entries(splits).map(([partition, data]) => [partition,
  Object.fromEntries([...new Set(data.baseline.rows.map(row => row.domain))].map(domain => [domain,
    Object.fromEntries(['rawClip', 'baseline', 'mlp'].map(name => {const rows=data[name].rows.filter(row=>row.domain===domain);return [name,{choices:rows.length,chosenAt1:rows.reduce((n,row)=>n+row.chosenAt1,0)}];}))]))]));
const report = { domainResults, candidateWeightsSha256, rawClipConclusion, scoring: { rawClip: 'Image–meaning embedding cosine only.', baseline: 'App CLIP scene, contrast and unwanted-content semantic score.', mlp: 'App CLIP semantic score plus bounded semantic MLP adjustment.' }, kind: 'fixed-recipe-real-image-personalizer-benchmark', dataset: manifest.kind || encoded.kind, targetTask: 'semantic',
  encoder: encoded.encoder, preprocessing: encoded.preprocessing, recipe: config,
  dataSha256: createHash('sha256').update(JSON.stringify(encoded.events)).digest('hex'),
  manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
  elapsedMs: performance.now() - start, epochsReported: trainingTrace.length, trainingTrace, accepted, appLossAcceptance: result.accepted, acceptanceReason: accepted ? 'Reliable first-choice improvement over both raw CLIP and the app CLIP ranker.' : 'No reliable first-choice improvement over both CLIP baselines; generic head disabled.',
  conclusion: mlp.chosenAt1 < baseline.chosenAt1 ? 'The app CLIP semantic ranker matched more held-out choices in this fixed run.'
    : mlp.chosenAt1 === baseline.chosenAt1 ? 'No held-out first-choice advantage was measured for the MLP.'
      : accepted ? 'The MLP matched more held-out choices and passed the configured acceptance check.'
        : 'The MLP matched more held-out choices, but the configured reliability check did not pass.',
  diversity: validated.diversity, splits,
  notes: ['rawClip uses only image–meaning cosine. baseline uses the app CLIP scene/contrast/content score. mlp adds its bounded adjustment to the app baseline.',
    'Scores use the supplied real encoder features. This CLI does not rerun pixels, provider retrieval or Gemini.',
    'Explicit manifest partitions remain frozen after QA exclusions; each source photo, hash and target meaning stays in one declared partition. Byte hashes cannot establish perceptual independence; near-duplicate clusters should be annotated when known.',
    'Candidate ordering breaks exact score ties for chosenAt1; ties and fractional tie credit are reported separately.',
    'The paired bootstrap resamples complete meaning families rather than treating related comparisons as independent.',
    'A single fixed recipe is fitted on training data and early-stopped on validation data. Test results are reported afterward; use a fresh test set for later recipe selection.',
    'The candidate is saved for inspection only. This command does not activate or bundle any model.'] };
const serialize = value => JSON.stringify(value, (_key, item) => ArrayBuffer.isView(item) ? Array.from(item) : item, 2) + '\n';
if (flag('candidate-output')) await writeFile(flag('candidate-output'), serialize({ model: candidate, candidateWeightsSha256, accepted, recipe: config }));
if (flag('output')) await writeFile(flag('output'), serialize(report));
console.log(serialize({ rawClipConclusion, conclusion: report.conclusion, accepted: report.accepted, diversity: report.diversity,
  splits: Object.fromEntries(Object.entries(splits).map(([name, row]) => [name, { rawClip: { matches: row.rawClip.chosenAt1, choices: row.rawClip.choices, agreement: row.rawClip.chosenAt1Rate, pairwiseLoss: row.rawClip.meanPairwiseLoss }, appClip: { matches: row.baseline.chosenAt1, choices: row.baseline.choices, pairwiseLoss: row.baseline.meanPairwiseLoss },
    mlp: { matches: row.mlp.chosenAt1, choices: row.mlp.choices, pairwiseLoss: row.mlp.meanPairwiseLoss }, pairedMeaningBootstrap: row.pairedMeaningBootstrap, rawClipVsMlpMeaningBootstrap: row.rawClipVsMlpMeaningBootstrap }])) }));
