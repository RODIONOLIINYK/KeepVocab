// User-selected operating point. Target match must meet the minimum similarity,
// exceed the unwanted-content prompt score (selected > unwanted), and not score
// lower than a known contrast or different-category sense (margin >= 0).
export const IMAGE_SEMANTIC_FILTER = Object.freeze({
  minimumSimilarity: .19,
  candidatePoolSize: 30
});

export function passesImageSemanticGate(semantic, policy = IMAGE_SEMANTIC_FILTER) {
  return Boolean(semantic && Number.isFinite(semantic.selected) && Number.isFinite(semantic.unwanted)
    && semantic.selected >= policy.minimumSimilarity
    && semantic.selected > semantic.unwanted
    && (!Number.isFinite(semantic.margin) || semantic.margin >= 0)
    && (!Number.isFinite(policy?.maximumUnwanted) || semantic.unwanted < policy.maximumUnwanted));
}
