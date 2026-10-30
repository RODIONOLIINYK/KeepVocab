// User-selected operating point, frozen before the new Pexels UI evaluation.
// Cosine similarity is not a calibrated probability of semantic correctness.
export const IMAGE_SEMANTIC_FILTER = Object.freeze({
  minimumSimilarity: .19,
  maximumUnwanted: .20,
  candidatePoolSize: 30
});

export function passesImageSemanticGate(semantic, policy = IMAGE_SEMANTIC_FILTER) {
  return Boolean(semantic && Number.isFinite(semantic.selected) && Number.isFinite(semantic.unwanted)
    && semantic.selected >= policy.minimumSimilarity && semantic.unwanted < policy.maximumUnwanted);
}
