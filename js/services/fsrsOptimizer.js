// A conservative local parameter fitter around the published FSRS-6 equations.
// This is KeepVocab's bounded coordinate search, not the upstream Rust optimizer.
import { FSRSAlgorithm, CLAMP_PARAMETERS, clipParameters } from '../vendor/fsrs.js';
import { FSRS_DEFAULT_WEIGHTS, elapsedFsrsDays, validFsrsWeights } from './fsrsConfig.js';
import { MEMORY_FEATURE_NAMES, probabilityLogit, calibratedRecallProbability } from './memoryFeatures.js';
import { mergeReviewEvents } from './reviewHistory.js';
export const MIN_TRAINING_REVIEWS = 400;
export const MIN_TRAINING_WORDS = 50;
const clampProbability = value => Math.max(0.001, Math.min(0.999, value));
export function reviewDatasetFingerprint(events) {
  let hash = 2166136261;
  for (const event of events) for (const char of JSON.stringify([event.id, event.grade, event.occurredAt, event.context])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function predictReviewHistory(events, weights, cutoff = Infinity) {
  const algorithm = new FSRSAlgorithm({ w: weights, enable_short_term: true });
  const states = new Map();
  const predictions = [];
  for (const event of events) {
    const key = JSON.stringify([event.wordId, event.senseId, event.channel]);
    let previous = states.get(key);
    if (!previous) {
      const before = event.memory.before;
      previous = { state: before.state ? { stability: before.stability, difficulty: before.difficulty } : null, last: before.last_review };
    }
    const elapsed = elapsedFsrsDays(previous.last, event.occurredAt);
    if (previous.state && elapsed > 0) predictions.push({ event, probability: clampProbability(algorithm.forgetting_curve(elapsed, previous.state.stability)),
      correct: event.grade !== 1, training: Date.parse(event.occurredAt) <= cutoff });
    const next = algorithm.next_state(previous.state, elapsed, event.grade);
    states.set(key, { state: next, last: event.occurredAt });
  }
  return predictions;
}
export function predictionMetrics(predictions, calibration = null) {
  if (!predictions.length) return { count: 0, logLoss: null, brier: null };
  let logLoss = 0, brier = 0;
  for (const item of predictions) {
    const probability = clampProbability(calibratedRecallProbability(item.probability, item.event.context, calibration));
    const y = Number(item.correct);
    logLoss -= y * Math.log(probability) + (1 - y) * Math.log(1 - probability);
    brier += (probability - y) ** 2;
  }
  return { count: predictions.length, logLoss: logLoss / predictions.length, brier: brier / predictions.length };
}
export function fitMemoryCalibration(predictions) {
  const examples = predictions.filter(item => item.event.context.length === MEMORY_FEATURE_NAMES.length);
  if (examples.length < 200 || examples.filter(item => !item.correct).length < 20) return null;
  const weights = Array(MEMORY_FEATURE_NAMES.length).fill(0);
  for (let epoch = 0; epoch < 80; epoch++) {
    const gradient = weights.map(value => value * 0.1);
    for (const { event, correct, probability } of examples) {
      const rawDelta = event.context.reduce((sum, value, index) => sum + value * weights[index], 0);
      // Fit the same bounded correction used during scheduling. A saturated
      // correction has zero data gradient; regularization can still shrink it.
      const z = probabilityLogit(probability) + Math.max(-.5, Math.min(.5, rawDelta));
      const error = (1 / (1 + Math.exp(-z)) - Number(correct)) / examples.length;
      for (let index = 0; index < weights.length; index++) gradient[index] += Math.abs(rawDelta) < .5 ? error * event.context[index] : 0;
    }
    for (let index = 0; index < weights.length; index++) weights[index] -= 0.25 * gradient[index];
  }
  return weights;
}
function improveEnough(after, before) {
  return Number.isFinite(after.logLoss) && after.logLoss <= before.logLoss - Math.max(0.002, before.logLoss * 0.01)
    && after.brier <= before.brier + 0.001;
}
export function optimizeFsrsChannel(input, channel, previous = null, { progress = () => {} } = {}) {
  const all = mergeReviewEvents(input).filter(event => event.channel === channel && event.memory.scheduled
    && (!event.memory.before.last_review || Date.parse(event.memory.before.last_review) <= Date.parse(event.occurredAt)));
  // Keep whole word histories. A fixed recent subset bounds CPU work without
  // pretending a truncated history started with a new card.
  const grouped = new Map();
  for (const event of all) {
    const key = JSON.stringify([event.wordId, event.senseId]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }
  const recentHistories = [...grouped.values()].sort((a, b) => b.at(-1).occurredAt.localeCompare(a.at(-1).occurredAt));
  const selected = [];let remaining = 6000;
  for (const history of recentHistories) if (history.length <= remaining && selected.length < 1000) { selected.push(history); remaining -= history.length; }
  const events = selected.flat().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const baseline = validFsrsWeights(previous?.weights) ? previous.weights : FSRS_DEFAULT_WEIGHTS;
  const datasetFingerprint = reviewDatasetFingerprint(events);
  if (datasetFingerprint === previous?.datasetFingerprint) return { accepted: false, reason: 'No new review history.', datasetFingerprint };
  const observations = predictReviewHistory(events, baseline);
  const eligible = observations.length;
  const failures = observations.filter(item => !item.correct).length;
  const distinctWords = new Set(observations.map(item => JSON.stringify([item.event.wordId, item.event.senseId]))).size;
  const stats = { eligible, failures, distinctWords, datasetFingerprint };
  if (eligible < MIN_TRAINING_REVIEWS || distinctWords < MIN_TRAINING_WORDS || failures < 30 || eligible - failures < 30) {
    return { ...stats, accepted: false, reason: `Needs ${MIN_TRAINING_REVIEWS} spaced reviews across ${MIN_TRAINING_WORDS} meanings, with both remembered and forgotten answers.` };
  }
  const split = Math.floor(observations.length * 0.8);
  const cutoff = Date.parse(observations[split - 1].event.occurredAt);
  const trainEvents = events.filter(event => Date.parse(event.occurredAt) <= cutoff);
  const baselinePredictions = predictReviewHistory(events, baseline, cutoff);
  const validation = baselinePredictions.filter(item => !item.training);
  if (validation.length < 60 || validation.filter(item => !item.correct).length < 5 || validation.filter(item => item.correct).length < 5) {
    return { ...stats, accepted: false, reason: 'More later reviews with both outcomes are needed for chronological validation.' };
  }
  const objective = weights => {
    const metrics = predictionMetrics(predictReviewHistory(trainEvents, weights));
    const penalty = weights.reduce((sum, value, index) => sum + ((value - baseline[index]) / Math.max(0.1, Math.abs(baseline[index]))) ** 2, 0) * 0.002 / 21;
    return metrics.logLoss + penalty;
  };
  let weights = [...baseline];
  let best = objective(weights);
  const bounds = CLAMP_PARAMETERS(2, true);
  for (let pass = 0; pass < 4; pass++) {
    for (let index = 0; index < 21; index++) {
      const step = Math.max(0.001, Math.abs(baseline[index]) * 0.25, (bounds[index][1] - bounds[index][0]) * 0.005) * 0.5 ** pass;
      const center = weights[index];
      let winner = weights;
      for (const direction of [-1, 1]) {
        const candidate = [...weights];candidate[index] = center + direction * step;
        const clipped = clipParameters(candidate, 1, true);
        if (clipped.slice(1, 4).some((value, i) => value < clipped[i])) continue;
        const loss = objective(clipped);
        if (Number.isFinite(loss) && loss < best - 1e-8) { best = loss; winner = clipped; }
      }
      weights = winner;
    }
    progress({ channel, pass: pass + 1, total: 4 });
  }
  const predictions = predictReviewHistory(events, weights, cutoff);
  const trainPredictions = predictions.filter(item => item.training);
  const heldOut = predictions.filter(item => !item.training);
  const previousMetrics = predictionMetrics(validation, previous?.calibration);
  const previousMemoryMetrics = predictionMetrics(validation);
  const candidateMetrics = predictionMetrics(heldOut);
  const calibration = fitMemoryCalibration(trainPredictions);
  const calibratedMetrics = predictionMetrics(heldOut, calibration);
  const useCalibration = calibration && improveEnough(calibratedMetrics, candidateMetrics);
  const metrics = useCalibration ? calibratedMetrics : candidateMetrics;
  // Priority calibration must never hide a regression in the memory model
  // whose uncalibrated predictions determine actual review intervals.
  const accepted = improveEnough(candidateMetrics, previousMemoryMetrics) && improveEnough(metrics, previousMetrics);
  const deltaL2 = Math.hypot(...weights.map((value, index) => value - baseline[index]));
  const result = { ...stats, accepted, trainingReviews: trainPredictions.length, validationReviews: heldOut.length,
    before: previousMetrics, after: metrics, deltaL2, changedParameters: weights.filter((value, index) => Math.abs(value - baseline[index]) > 1e-8).length,
    reason: accepted ? 'Personal parameters improved prediction on later, held-out reviews.' : 'The candidate did not improve later-review prediction enough. Current parameters were retained.' };
  if (accepted) result.model = { algorithm: 'FSRS-6', weights, calibration: useCalibration ? calibration : null,
    featureVersion: 1, revision: (previous?.revision || 0) + 1, trainedAt: new Date().toISOString(), datasetFingerprint,
    eligibleReviews: eligible, validationReviews: heldOut.length, before: previousMetrics, after: metrics,
    deltaL2, changedParameters: result.changedParameters, method: 'bounded-coordinate-search-v1' };
  return result;
}
