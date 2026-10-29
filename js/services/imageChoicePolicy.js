import { CLIP_TAG } from '../ml/clipConfig.js';

// A better average pairwise result must not hide fewer complete correct choices.
export function imageRankingAcceptance(result) {
  const agreement = metric => Array.isArray(metric?.rows) && metric.rows.length
    ? metric.rows.filter(row => row.accuracy >= 1 - 1e-12 && row.rejectedAboveThreshold === 0).length / metric.rows.length : null;
  const after = agreement(result?.after);
  const comparators = [result?.before, result?.baseline, result?.semanticBaseline].filter(Boolean).map(agreement);
  if (after === null || !comparators.length || comparators.some(value => value === null)) {
    return { accepted: false, reason: 'Complete held-out image choices are required before promoting a model.' };
  }
  const accepted = comparators.every(value => after >= value - 1e-12);
  return { accepted, afterAgreement: after, comparatorAgreements: comparators,
    reason: accepted ? 'Held-out first-choice ranking did not regress.' : 'Current model retained because held-out first-choice ranking regressed.' };
}

// Suggest a clear semantic match. Learned preference affects the fused rank
// score, but its sigmoid output is not calibrated confidence in correctness.
export function canAutoSelectImage(candidates) {
  const [first, ...others] = candidates || [];
  const ml = first?.ml;
  return Boolean(first?.url && ml?.model === CLIP_TAG && typeof ml.sense === 'string' && ml.sense && others.length
    && others.every(item => item?.url && item.ml?.model === CLIP_TAG && ml.sense === item.ml.sense
      && [item.ml.selected, item.ml.margin, item.ml.unwanted, item.ml.score].every(Number.isFinite))
    && [ml.selected, ml.margin, ml.unwanted, ml.score].every(Number.isFinite)
    && ml.selected >= 0.3
    && (ml.contrast === null ? ml.selected >= 0.38 : ml.margin >= 0.08)
    && ml.unwanted < 0.2 && ml.score - Math.max(...others.map(item => item.ml.score)) >= 0.04);
}

const sameImage = (left, right) => Boolean(left?.url && right?.url && (left.url === right.url
  || (left.sourceUrl && left.sourceUrl === right.sourceUrl)));

// The caller supplies only photos actually shown to the person. An unchosen
// photo may still fit the meaning: teach a relative preference, not a rejection.
export function imageChoiceLabels(word, selected, viewedCandidates = []) {
  if (!selected?.url) return [];
  const alternatives = [];
  for (const image of viewedCandidates || []) {
    if (!image?.url || sameImage(image, selected) || alternatives.some(item => sameImage(item, image))) continue;
    alternatives.push(image);
    if (alternatives.length === 3) break;
  }
  const decisionId = globalThis.crypto?.randomUUID?.() || `choice-${Date.now()}-${Math.random()}`;
  return [{ word, action: 'good', image: selected, decisionId }, ...alternatives.map(image => ({
    word, action: 'less-preferred', image, preferredImage: selected, decisionId
  }))];
}

export function imageReplacementLabels(word, previous, selected) {
  return imageChoiceLabels(word, selected, previous?.url ? [previous] : []);
}
