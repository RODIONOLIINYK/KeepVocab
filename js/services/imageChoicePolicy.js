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

// Explain the automation gate in terms of the user's choices. The preference
// score is not calibrated confidence, so it must never become a percentage.
export function imageChoiceGuidance(candidates, status = {}) {
  if (status.enabled === false) {
    return { title: 'Choose an image', detail: 'Local learning is off. You can turn it on in Settings.', kind: 'manual' };
  }
  const scored = Boolean(candidates?.[0]?.url && candidates[0]?.ml?.model === CLIP_TAG
    && Number.isFinite(candidates[0].ml.score));
  if (status.enabled === true && !scored && ['loading', 'scoring'].includes(status.phase)) {
    return { title: 'Local learning is on', detail: status.phase === 'loading'
      ? 'The image model is loading. You can choose a photo while it gets ready.'
      : 'The image model is scoring these photos. You can still choose one yourself.', kind: 'learning' };
  }
  if (!candidates?.length) {
    return { title: 'Choose an image', detail: 'Find photos, then choose one that fits the meaning.', kind: 'manual' };
  }
  if (status.phase === 'error') {
    return { title: 'Choose an image', detail: status.enabled === true
      ? 'Local learning is on, but scoring is unavailable right now. Check the model in Settings or choose a photo yourself.'
      : 'Local scoring is unavailable for these photos. Choose one that fits the meaning.', kind: 'manual' };
  }
  if (!scored && status.installed === false) {
    return { title: 'Choose an image', detail: status.enabled === true
      ? 'Local learning is on. The image model is not ready on this device yet. Check its download in Settings or choose a photo yourself.'
      : 'The image model is not ready on this device yet. Check its download in Settings or choose a photo yourself.', kind: 'manual' };
  }
  if (!scored) {
    return { title: 'Choose an image', detail: 'Local scoring is unavailable for these photos. Choose one that fits the meaning.', kind: 'manual' };
  }
  if (canAutoSelectImage(candidates)) {
    return { title: 'Selected for you', detail: 'A clear match for this meaning and your rated preferences. You can choose another.', kind: 'automatic' };
  }
  // Explain the model that actually scored this set, even if more labels have
  // been saved since the search. Saved examples can still be waiting to train.
  const count = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const trainedLabels = count(candidates[0].ml.trainedLabels ?? status.trainedLabels);
  const labels = count(status.labels ?? trainedLabels);
  if (trainedLabels < 32) {
    const saved = labels !== trainedLabels ? ` ${labels} saved so far.` : '';
    const balance = trainedLabels === 0 && labels >= 8
      ? ' Training needs at least two liked and two rejected examples.' : '';
    return {
      title: 'Learning your taste',
      detail: `${trainedLabels}/32 rated examples used for training.${saved}${balance} Choose photos you like; automatic picks need enough ratings and a clear match.`,
      kind: 'learning'
    };
  }
  return { title: 'Your choice needed', detail: 'No clear winner for this meaning and your preferences. Choose the photo that fits best.', kind: 'manual' };
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
