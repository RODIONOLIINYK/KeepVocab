// Small regularized logistic heads. Coordinate statistics and normalization are
// fitted only on training observations; held-out features never affect them.
export const logistic = z => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
export function fitLogisticHead(rows, labels, { prior = [], bias = 0, regularization = 3, epochs = 300, sampleWeights = null, balanceClasses = true, effectiveSampleCount = rows.length } = {}) {
  if (!rows.length || rows.length !== labels.length) return null;
  const dimension = rows[0].length;
  if (rows.some(row => row.length !== dimension || row.some(x => !Number.isFinite(x))) || labels.some(y => y !== 0 && y !== 1)) return null;
  const positive = labels.reduce((a, b) => a + b, 0), negative = labels.length - positive;
  if (positive < 2 || negative < 2) return null;
  const mass = sampleWeights || labels.map(() => 1);
  if (mass.length !== rows.length || mass.some(x => !Number.isFinite(x) || x <= 0)) return null;
  const total = mass.reduce((s, x) => s + x, 0), posMass = labels.reduce((s, y, i) => s + (y ? mass[i] : 0), 0), negMass = total - posMass;
  const mean = Array.from({ length: dimension }, (_, j) => rows.reduce((s, r, i) => s + mass[i] * r[j], 0) / total);
  const scale = mean.map((mu, j) => Math.max(.02, Math.sqrt(rows.reduce((s, r, i) => s + mass[i] * (r[j] - mu) ** 2, 0) / total)));
  const initial = scale.map((s, j) => (prior[j] || 0) * s);
  const weights = [...initial];
  const initialBias = bias + mean.reduce((s, mu, j) => s + mu * (prior[j] || 0), 0);
  let intercept = initialBias;
  const normalized = rows.map(row => row.map((x, j) => (x - mean[j]) / scale[j]));
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = weights.map((w, j) => regularization * (w - initial[j]) / effectiveSampleCount);
    let gb = regularization * (intercept - initialBias) / effectiveSampleCount;
    for (let i = 0; i < rows.length; i++) {
      const x = normalized[i], y = labels[i];
      const error = (logistic(intercept + weights.reduce((s, w, j) => s + w * x[j], 0)) - y) * mass[i] / (balanceClasses ? 2 * (y ? posMass : negMass) : total);
      for (let j = 0; j < dimension; j++) gradient[j] += error * x[j];
      gb += error;
    }
    for (let j = 0; j < dimension; j++) weights[j] -= .08 * gradient[j];
    intercept -= .08 * gb;
  }
  return { weights, bias: intercept, mean, scale, sampleCount: rows.length };
}
export function validLogisticHead(head, dimension) {
  return Boolean(head && Number.isFinite(head.bias) && ['weights', 'mean', 'scale'].every(key => Array.isArray(head[key]) && head[key].length === dimension && head[key].every(Number.isFinite)) && head.scale.every(x => x > 0));
}
export function logisticScore(head, features) {
  return logistic(head.bias + head.weights.reduce((sum, w, j) => sum + w * (features[j] - head.mean[j]) / head.scale[j], 0));
}
export function logisticPrior(head) {
  return { prior: head.weights.map((w, j) => w / head.scale[j]),
    bias: head.bias - head.weights.reduce((sum, w, j) => sum + w * head.mean[j] / head.scale[j], 0) };
}
