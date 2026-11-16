// Exact five-feature reference scorer. Pooling includes special tokens and the
// complete context; token matching excludes specials and the first-colon prefix.
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const normalize = values => {
  const norm = Math.max(Math.hypot(...values), 1e-12);
  return values.map(value => value / norm);
};
export function referenceEmbedding(hidden, ids, mask, specialIds, colonId) {
  const pooled = Array(hidden[0].length).fill(0);
  const valid = [];
  let count = 0;
  for (let i = 0; i < ids.length; i++) if (mask[i]) {
    count++;
    hidden[i].forEach((value, axis) => { pooled[axis] += value; });
    if (!specialIds.has(ids[i])) valid.push(i);
  }
  if (!count) throw new Error('Empty meaning input.');
  const colon = ids.indexOf(colonId);
  const withoutPrefix = valid.filter(index => index > colon);
  const selected = withoutPrefix.length ? withoutPrefix : valid;
  return { pooled: normalize(pooled.map(value => value / count)),
    tokens: selected.map(index => normalize(hidden[index])), ids: selected.map(index => ids[index]) };
}
function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
export function referenceFeatures(a, b, scorer) {
  const cosine = Math.max(-1, Math.min(1, dot(a.pooled, b.pooled)));
  if (!a.tokens.length || !b.tokens.length) return [cosine, cosine, cosine, cosine, 1];
  const ab = a.tokens.map(left => Math.max(...b.tokens.map(right => dot(left, right))));
  const ba = b.tokens.map(right => Math.max(...a.tokens.map(left => dot(left, right))));
  const weightedMean = (values, ids) => {
    const weights = ids.map(id => scorer.idfLookup[id] ?? scorer.defaultIdf);
    return values.reduce((sum, value, i) => sum + value * weights[i], 0) / Math.max(1e-6, weights.reduce((sum, w) => sum + w, 0));
  };
  return [cosine, (weightedMean(ab, a.ids) + weightedMean(ba, b.ids)) / 2,
    (Math.min(...ab) + Math.min(...ba)) / 2, (quantile(ab, .25) + quantile(ba, .25)) / 2,
    Math.min(ab.length, ba.length) / Math.max(ab.length, ba.length)];
}
export function referenceProbability(features, scorer) {
  const logit = dot(features, scorer.weights) + scorer.bias;
  return 1 / (1 + Math.exp(-logit));
}
