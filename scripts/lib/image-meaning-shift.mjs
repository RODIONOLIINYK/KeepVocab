// Offline experiment only. The original meaning-disjoint validator stays strict.
import { trainingMetrics } from './image-training-diagnostics.mjs';

const requireCondition = (value, message) => { if (!value) throw Error(message); };
const canonical = value => { const url = new URL(value); url.search = ''; url.hash = ''; return url.href; };
export function photoIdentities(photo) {
  return [`id:${photo.id}`, `sha256:${photo.sha256.toLowerCase()}`, `url:${canonical(photo.url)}`,
    ...(photo.sourceUrl ? [`source:${canonical(photo.sourceUrl)}`] : []),
    ...(photo.duplicateGroup ? [`duplicate:${photo.duplicateGroup}`] : [])];
}

export function auditMeaningShiftSplit(validated, plan, arm) {
  requireCondition(['seen', 'unseen'].includes(arm), 'Unknown meaning-shift arm.');
  const byId = new Map(Object.values(validated.split).filter(Array.isArray).flat().map(row => [row.id, row]));
  const ids = { train: [...plan.commonIds, ...plan[`${arm}ExposureIds`]], validation: plan.validationIds, test: plan.testIds };
  const owners = new Map(), used = new Set(), meanings = {}, families = {}, split = {}, summary = {};
  for (const [name, caseIds] of Object.entries(ids)) {
    requireCondition(Array.isArray(caseIds) && caseIds.length > 0, `Empty ${name} split.`);
    meanings[name] = new Set(); families[name] = new Set(); const hashes = new Set();
    split[name] = caseIds.map(id => {
      const item = validated.cases.get(id), decision = byId.get(id);
      requireCondition(item && decision && !used.has(id), `Missing or repeated gallery ${id}.`); used.add(id);
      meanings[name].add(item.meaningId); families[name].add(item.familyId || item.meaningId);
      for (const photo of item.candidates) {
        hashes.add(photo.sha256);
        for (const identity of photoIdentities(photo)) {
          requireCondition(!owners.has(identity) || owners.get(identity) === name, `Cross-partition photo leakage: ${identity}.`);
          owners.set(identity, name);
        }
      }
      return decision;
    });
    summary[name] = { galleries: caseIds.length, comparisons: split[name].reduce((n, row) => n + row.records.length, 0),
      meanings: meanings[name].size, families: families[name].size, uniquePhotos: hashes.size };
  }
  requireCondition(meanings.validation.size === meanings.test.size
    && [...meanings.validation].every(id => meanings.test.has(id)), 'Validation and test must contain the same target meanings.');
  for (const name of ['validation', 'test']) {
    requireCondition([...meanings[name]].every(id => arm === 'seen' ? meanings.train.has(id) : !meanings.train.has(id)),
      `Invalid ${arm} meaning coverage in ${name}.`);
    if (arm === 'unseen') requireCondition([...families[name]].every(id => !families.train.has(id)), 'Unseen control leaks a target family.');
  }
  requireCondition(plan.seenExposureIds.length === plan.unseenExposureIds.length, 'Exposure gallery counts differ.');
  requireCondition(meanings.validation.size >= 2, 'At least two independently held-out meanings are required.');
  return { split, cases: validated.cases, summary, identityChecksPassed: true };
}

/** Compare predictions on identical galleries; resample whole target meanings. */
export function pairedShiftDifference(before, after, { samples = 10000, seed = 20261029 } = {}) {
  requireCondition(before.rows?.length && before.rows.length === after.rows?.length, 'Paired rows required.');
  requireCondition(Number.isInteger(samples) && samples > 0, 'Positive bootstrap sample count required.');
  const groups = new Map(); let improved = 0, worsened = 0, binary = true;
  before.rows.forEach((row, i) => {
    const next = after.rows[i]; requireCondition(row.id === next.id && row.meaningId === next.meaningId, 'Paired rows do not match.');
    binary &&= [row.chosenAt1, next.chosenAt1].every(value => value === 0 || value === 1);
    const difference = next.chosenAt1 - row.chosenAt1;
    improved += Number(difference > 0); worsened += Number(difference < 0);
    if (!groups.has(row.meaningId)) groups.set(row.meaningId, []);
    groups.get(row.meaningId).push({ accuracy: difference, loss: row.loss - next.loss });
  });
  const means = [...groups.values()].map(rows => ({ accuracy: rows.reduce((n, row) => n + row.accuracy, 0) / rows.length,
    loss: rows.reduce((n, row) => n + row.loss, 0) / rows.length }));
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const metrics = {};
  for (const key of ['accuracy', 'loss']) {
    const values = Array.from({ length: samples }, () => means.reduce(sum => sum + means[Math.floor(random() * means.length)][key], 0) / means.length).sort((a, b) => a - b);
    metrics[key] = { meanDifference: means.reduce((n, row) => n + row[key], 0) / means.length,
      lower95: values[Math.floor(samples * .025)], upper95: values[Math.min(samples - 1, Math.floor(samples * .975))] };
  }
  // Exact paired sign/McNemar test conditional on the discordant predictions.
  const n = improved + worsened, k = Math.min(improved, worsened); let mass = 2 ** -n, tail = mass;
  for (let i = 1; i <= k; i++) { mass *= (n - i + 1) / i; tail += mass; }
  return { meanings: means.length, galleries: before.rows.length, improved, worsened,
    exactDiscordanceP: binary && groups.size === before.rows.length ? n ? Math.min(1, 2 * tail) : 1 : null, metrics, bootstrapSamples: samples,
    positiveDifferenceFavors: 'after', unit: 'meaning', noObservedDiscordance: n === 0,
    zeroDiscordanceUpper95: n === 0 && binary && groups.size === before.rows.length ? 1 - .05 ** (1 / means.length) : null,
    zeroDiscordanceCaveat: 'The bound assumes independent sampled meanings and concerns an unseen discordance rate; it is not a population guarantee for this curated dataset. A degenerate bootstrap interval does not establish equivalence.',
    note: 'Conditional paired regression comparison, not proof of population causality.' };
}

export const shiftMetrics = (model, decisions, cases) => trainingMetrics(model, decisions, cases, { rows: true });
