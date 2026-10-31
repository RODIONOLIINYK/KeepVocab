// Portable inference for offline classifier artifacts; not activated by the app.
import { CLIP_TAG } from '../../js/ml/clipConfig.js';
import { MEANING_CATEGORIES } from './meaning-taxonomy.mjs';

export function validMeaningCategoryClassifier(model) {
  if (model?.schemaVersion !== 1 || model.version !== 'meaning-category-v1'
    || model.role !== 'meaning-category' || model.encoder !== CLIP_TAG
    || model.inputDimension !== 512 || JSON.stringify(model.categories) !== JSON.stringify(MEANING_CATEGORIES)
    || !['logistic-regression', 'mlp'].includes(model.modelType)
    || !Number.isFinite(model.decisionThreshold) || model.decisionThreshold <= 0 || model.decisionThreshold >= 1) return false;
  const { mean, scale } = model.preprocessor || {};
  if (![mean, scale].every(values => Array.isArray(values) && values.length === 512 && values.every(Number.isFinite))
    || scale.some(value => value <= 0)) return false;
  if (!Array.isArray(model.layers) || model.layers.length !== (model.modelType === 'mlp' ? 2 : 1)) return false;
  if (model.calibration && (!['none', 'temperature', 'temperature-global-bias', 'temperature-class-bias'].includes(model.calibration.method)
    || !Number.isFinite(model.calibration.temperature) || model.calibration.temperature <= 0
    || !Array.isArray(model.calibration.offsets) || model.calibration.offsets.length !== 6
    || !model.calibration.offsets.every(Number.isFinite))) return false;
  let dimension = 512;
  for (const [index, layer] of model.layers.entries()) {
    const output = layer?.bias?.length;
    if (!output || !Array.isArray(layer.bias) || !layer.bias.every(Number.isFinite)
      || !Array.isArray(layer.weights) || layer.weights.length !== dimension
      || !layer.weights.every(row => Array.isArray(row) && row.length === output && row.every(Number.isFinite))
      || layer.activation !== (index < model.layers.length - 1 ? 'tanh' : 'linear')) return false;
    dimension = output;
  }
  return dimension === MEANING_CATEGORIES.length;
}

export function meaningCategoryProbabilities(model, vector) {
  if (!validMeaningCategoryClassifier(model)) throw new Error('Unsupported meaning-category classifier.');
  if ((!Array.isArray(vector) && !ArrayBuffer.isView(vector)) || vector.length !== 512
    || !Array.from(vector).every(Number.isFinite)) throw new Error('A finite 512-coordinate CLIP text vector is required.');
  let values = Array.from(vector, (value, index) => (value - model.preprocessor.mean[index]) / model.preprocessor.scale[index]);
  for (const layer of model.layers) {
    const output = [...layer.bias];
    for (let i = 0; i < values.length; i++) for (let j = 0; j < output.length; j++) output[j] += values[i] * layer.weights[i][j];
    values = layer.activation === 'tanh' ? output.map(Math.tanh) : output;
  }
  // Independent sigmoids preserve overlapping classes; never softmax/argmax.
  const sigmoid = value => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
  const probabilities = values.map(sigmoid);
  if (!model.calibration || model.calibration.method === 'none') return probabilities;
  return probabilities.map((value, index) => {
    const clipped = Math.max(1e-10, Math.min(1 - 1e-10, value));
    return sigmoid(Math.log(clipped / (1 - clipped)) / model.calibration.temperature + model.calibration.offsets[index]);
  });
}
