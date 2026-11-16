// Export verification only. No training, fitting, or threshold selection.
// Input rows must be dictionary-extracted reference validation predictions:
// { pairId, textA, textB, score }. Keep those local, outside the app bundle.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer, AutoModel, env } from '@huggingface/transformers';
import { referenceEmbedding, referenceFeatures, referenceProbability } from '../js/services/meaningReferenceFeatures.js';
import { MEANING_MERGE_THRESHOLD } from '../js/ml/meaningConfig.js';

const input = process.argv[2];
if (!input) throw new Error('Supply a reference validation input JSON file.');
const rows = JSON.parse(await readFile(input, 'utf8'));
const root = fileURLToPath(new URL('../models/meaning-minilm-reference/', import.meta.url));
env.allowRemoteModels = false;
const tokenizer = await AutoTokenizer.from_pretrained(root, { local_files_only: true });
const model = await AutoModel.from_pretrained(root, { local_files_only: true, dtype: 'fp16', device: 'cpu' });
const scorer = JSON.parse(await readFile(new URL('../models/meaning-minilm-reference/scorer.json', import.meta.url)));
const texts = [...new Set(rows.flatMap(row => [row.textA, row.textB]))], vectors = new Map();
try {
  for (let start = 0; start < texts.length; start += 8) {
    const batch = texts.slice(start, start + 8);
    const inputs = tokenizer(batch, { padding: 'max_length', max_length: 96, truncation: true });
    let output;
    try {
      output = await model(inputs);
      const hidden = output.last_hidden_state.tolist();
      const ids = inputs.input_ids.tolist().map(row => row.map(Number));
      const masks = inputs.attention_mask.tolist().map(row => row.map(Number));
      batch.forEach((text, i) => vectors.set(text, referenceEmbedding(hidden[i], ids[i], masks[i], new Set(tokenizer.all_special_ids), tokenizer.convert_tokens_to_ids(':'))));
    } finally { for (const tensor of [...Object.values(inputs), ...Object.values(output || {})]) tensor?.dispose?.(); }
  }
} finally { await model.dispose(); }
const predictions = rows.map(row => ({ ...row, actual: referenceProbability(referenceFeatures(vectors.get(row.textA), vectors.get(row.textB), scorer), scorer) }));
const maxScoreError = Math.max(...predictions.map(row => Math.abs(row.actual - row.score)));
const changedMergeDecisions = predictions.filter(row => (row.actual >= MEANING_MERGE_THRESHOLD) !== (row.score >= MEANING_MERGE_THRESHOLD)).map(row => row.pairId);
const report = { runtime: 'Transformers.js native CPU FP16', pairs: rows.length, texts: texts.length,
  maxScoreError, changedMergeDecisions, threshold: MEANING_MERGE_THRESHOLD,
  noFittingOrCalibration: true, predictions };
await writeFile(input.replace(/\.json$/, '-parity.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, predictions: undefined }));
if (maxScoreError > .005 || changedMergeDecisions.length) throw new Error('Reference export parity failed.');
