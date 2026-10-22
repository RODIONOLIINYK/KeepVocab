import { CLIP_TAG } from '../ml/clipConfig.js';

// This is a conservative opt-in-to-automation gate, not a calibrated measure
// of correctness. A new model must collect real ratings before it can choose.
export function canAutoSelectImage(candidates) {
  const [first, ...others] = candidates || [];
  const ml = first?.ml;
  return Boolean(first?.url && ml?.model === CLIP_TAG && others.length
    && others.every(item => item.ml?.model === CLIP_TAG && ml.sense === item.ml.sense && Number.isFinite(item.ml.score))
    && ml.trainedLabels >= 32
    && [ml.preference, ml.selected, ml.margin, ml.unwanted, ml.score].every(Number.isFinite)
    && ml.preference >= 0.9 && ml.selected >= 0.3
    && (ml.contrast === null ? ml.selected >= 0.38 : ml.margin >= 0.08)
    && ml.unwanted < 0.2 && ml.score - Math.max(...others.map(item => item.ml.score)) >= 0.04);
}

export function imageReplacementLabels(word, previous, selected) {
  if (!selected?.url) return [];
  const sameImage = previous?.url === selected.url
    || (previous?.sourceUrl && previous.sourceUrl === selected.sourceUrl);
  return [
    ...(previous?.url && !sameImage ? [{ word, action: 'wrong', image: previous }] : []),
    { word, action: 'good', image: selected }
  ];
}
