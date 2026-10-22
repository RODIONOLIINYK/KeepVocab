// Only information available BEFORE the answer enters prediction features.
// Current correctness, response time, confidence and hints are outcomes, not predictors.
export const MEMORY_FEATURE_VERSION = 1;
const scaled = (value, scale = 1) => Math.max(0, Math.min(1, (Number(value) || 0) / scale));
export const MEMORY_FEATURE_NAMES = ['word length', 'phrase length', 'noun', 'verb', 'adjective', 'adverb', 'recent errors', 'consecutive misses',
  'consecutive correct', 'unaided success rate', 'past hint rate', 'average past recall time', 'last answer time', 'last confidence',
  'previous recognition', 'previous assisted answer', 'confusions', 'recall days', 'hours since last answer', 'local hour sine', 'local hour cosine', 'session position', 'bias'];
export function memoryContextFeatures(word, now = new Date(), { stats = word?.practiceStats || {}, position = 0 } = {}) {
  const previous = word?.lastExerciseResult || {};
  const recent = Array.isArray(stats.recentResults) ? stats.recentResults.slice(-8) : [];
  const attempts = Math.max(1, Number(stats.attempts) || 0);
  const pos = String(word?.partOfSpeech || '').toLowerCase();
  const confusions = Object.values(word?.mistakes?.confusions || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  const hours = stats.lastAnsweredAt ? Math.max(0, (now - new Date(stats.lastAnsweredAt)) / 3600000) : 720;
  const hour = now.getHours() + now.getMinutes() / 60;
  const log = (value, scale) => scaled(Math.log1p(Math.max(0, Number(value) || 0)), scale);
  return [scaled(String(word?.word || '').length, 24), scaled(String(word?.word || '').trim().split(/\s+/).length, 5),
    ...['noun', 'verb', 'adjective', 'adverb'].map(value => Number(pos === value)),
    recent.length ? recent.filter(value => !value.correct).length / recent.length : scaled(stats.missed / attempts),
    scaled(stats.consecutiveMisses, 5), scaled(stats.consecutiveCorrect, 10), scaled(stats.unaidedRecalled / attempts),
    scaled(stats.hintsUsed / attempts, 3), log(stats.timedRecallCount ? stats.recallTimeTotalMs / stats.timedRecallCount / 1000 : 0, 5),
    log(previous.responseTimeMs / 1000, 5), previous.confidence == null ? 0 : Math.max(-1, Math.min(1, (previous.confidence - 0.5) * 2)),
    Number(previous.recallType === 'recognition' || (previous.recallType === 'context' && !previous.producedUnaided)),
    Number(previous.hintsUsed > 0), log(confusions, 4), log(stats.successfulRecallDays, 5), log(hours, 7),
    Math.sin(hour * Math.PI / 12), Math.cos(hour * Math.PI / 12), scaled(position, 30), 1];
}
export const probabilityLogit = value => Math.log(Math.max(0.001, Math.min(0.999, value)) / (1 - Math.max(0.001, Math.min(0.999, value))));
export function calibratedRecallProbability(probability, context, weights) {
  if (!weights || weights.length !== context.length || !weights.every(Number.isFinite)) return probability;
  const delta = Math.max(-0.5, Math.min(0.5, context.reduce((sum, value, index) => sum + value * weights[index], 0)));
  return 1 / (1 + Math.exp(-probabilityLogit(probability) - delta));
}
