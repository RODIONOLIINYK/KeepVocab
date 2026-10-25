import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validPersonalizer } from '../js/services/imagePersonalizer.js';
import { evaluateImagePipeline } from '../js/services/imageEvaluation.js';
import { imageEvaluationRuntime } from './image-evaluation-runtime.mjs';
const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
if (!file) throw new Error('Usage: node scripts/evaluate-image-pipeline.mjs fixtures.json [--download-model] [--output=report.json]');
const fixtures = JSON.parse(await readFile(file, 'utf8'));
const modelFile = args.find(a => a.startsWith('--model='))?.slice(8);
const modelData = modelFile ? JSON.parse(await readFile(modelFile, 'utf8')) : null;
const candidate = modelData?.model || modelData?.candidate || modelData;
if (candidate && !validPersonalizer(candidate)) throw new Error('Invalid candidate model; refusing to silently evaluate the baseline.');
const models = candidate ? { clip: null, candidate } : { clip: null };
const runtime = await imageEvaluationRuntime({ directory: dirname(resolve(file)), allowDownloads: args.includes('--download-model'),
  ...(args.includes('--center-crop-reference') ? { preprocessing: 'center-crop-256-reference' } : {}), progress: p => process.stderr.write(`${JSON.stringify(p)}\n`) });
try {
  const report = await evaluateImagePipeline(fixtures, { ...runtime, models, progress: p => process.stderr.write(`${JSON.stringify(p)}\n`) });
  const output = args.find(a => a.startsWith('--output='))?.slice(9);
  if (output) await writeFile(output, JSON.stringify(report));
  console.log(JSON.stringify({ ...report, events: `${report.events.length} training comparisons`, timingsMs: { total: report.timingsMs.reduce((a, b) => a + b, 0) } }, null, 2));
} finally { await runtime.dispose(); }
