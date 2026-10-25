import { CLIP_TAG } from '../../js/ml/clipConfig.js';
import { encodeFeatures, preferenceFeatures } from '../../js/services/imagePreferences.js';
import { IMAGE_PREPROCESSING, encodeMeaning } from '../../js/services/imagePersonalizer.js';
const vector = axis => Array.from({ length: 512 }, (_, i) => Number(i === axis));
const features = axis => encodeFeatures(preferenceFeatures(vector(axis), { selected: .4, margin: .1, unwanted: .05 }));
export function imageChoiceHistory(count = 60) {
  return Array.from({ length: count }, (_, i) => {
    const moving = i % 2 === 0;
    return { id: `event-${i}`, key: `pair-${i}`, decisionId: `choice-${i}`, meaningId: `meaning-${i}`, updatedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      encoder: CLIP_TAG, preprocessing: IMAGE_PREPROCESSING, kind: 'comparison', label: 0,
      features: features(moving ? 1 : 0), preferredFeatures: features(moving ? 0 : 1), meaningFeatures: encodeMeaning(vector(moving ? 0 : 1)) };
  });
}
