// SigLIP2 raw cosine is not a probability or the former encoder's score scale.
// A conservative validation-only manual-shortlist cutoff of .12852 was rounded
// upward to .13. Automatic image selection has separate, stricter checks.
// Target match must meet the minimum similarity,
// exceed the unwanted-content prompt score (selected > unwanted), and not score
// lower than an explicit visual contrast (margin >= 0). Generic dictionary
// alternatives remain ranking hints, since their descriptions can overlap.
export const IMAGE_SEMANTIC_FILTER = Object.freeze({
  minimumSimilarity: .13,
  closeContrastMargin: .02,
  candidatePoolSize: 45
});

export function passesImageSemanticGate(semantic, policy = IMAGE_SEMANTIC_FILTER) {
  return Boolean(semantic && Number.isFinite(semantic.selected) && Number.isFinite(semantic.unwanted)
    && semantic.selected >= policy.minimumSimilarity
    && semantic.selected > semantic.unwanted
    && (semantic.contrastSource === 'dictionary' || !Number.isFinite(semantic.margin) || semantic.margin >= 0)
    && (!Number.isFinite(policy?.maximumUnwanted) || semantic.unwanted < policy.maximumUnwanted));
}
