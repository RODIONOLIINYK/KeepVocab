// User-selected operating point. Target match must meet the minimum similarity
// and exceed the unwanted-content prompt score (selected > unwanted).
export const IMAGE_SEMANTIC_FILTER = Object.freeze({
  minimumSimilarity: .19,
  candidatePoolSize: 30
});

export function passesImageSemanticGate(semantic, policy = IMAGE_SEMANTIC_FILTER) {
  return Boolean(semantic && Number.isFinite(semantic.selected) && Number.isFinite(semantic.unwanted)
    && semantic.selected >= policy.minimumSimilarity
    && semantic.selected > semantic.unwanted
    && (!Number.isFinite(policy?.maximumUnwanted) || semantic.unwanted < policy.maximumUnwanted));
}
