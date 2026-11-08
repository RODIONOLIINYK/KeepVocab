// Comparison-only preprocessing. Original dictionary definitions, annotations,
// source IDs and explicit user judgments keep their exact text.
export const MEANING_COMPARISON_VERSION = 'parenthetical-free-v1';
export function meaningComparisonText(value) {
  let text = String(value || '');
  // Remove balanced nested round/square brackets from the inside out. An
  // unmatched bracket must not erase the rest of a dictionary definition.
  for (;;) {
    const next = text.replace(/\([^()[\]]*\)|\[[^()[\]]*\]/gu, ' ');
    if (next === text) return text.replace(/\s+/g, ' ').replace(/\s+([,;.!?])/g, '$1').trim();
    text = next;
  }
}
export function meaningGlossText(value) {
  return meaningComparisonText(value)
    // Dictionary subject/domain introductions qualify a use of the following
    // gloss; they are retained in the source rather than treated as its words.
    .replace(/^(?:of|said of|used of)\s+[^:;.!?]+?(?::|,)(?=\s*(?:to|a|an|the|having|being|not)\b)\s*/i, '')
    .trim();
}

export function meaningEmbeddingText(value) {
  return meaningComparisonText(value).toLowerCase();
}

export function meaningWords(value) {
  return meaningEmbeddingText(value).replaceAll('’', "'")
    .match(/\p{L}+(?:'\p{L}+)*|\p{N}+(?:[.,]\p{N}+)*/gu) || [];
}

export function countMatchingMeaningWords(left, right) {
  // Count the longest sequence of matching words, preserving word order
  // and counting each occurrence at most once.
  const counts = new Uint32Array(right.length + 1);
  for (const word of left) {
    let previous = 0;
    for (let index = 1; index <= right.length; index++) {
      const above = counts[index];
      counts[index] = word === right[index - 1]
        ? previous + 1 : Math.max(above, counts[index - 1]);
      previous = above;
    }
  }
  return counts[right.length];
}
