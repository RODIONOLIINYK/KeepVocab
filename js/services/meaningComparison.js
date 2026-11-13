// Comparison-only preprocessing. Original dictionary definitions, annotations,
// source IDs and explicit user judgments keep their exact text.
export const MEANING_COMPARISON_VERSION = 'semantic-qualifiers-v2';

const EDITORIAL_MODIFIERS = new Set([
  'chiefly', 'mainly', 'mostly', 'usually', 'often', 'especially', 'specifically',
  'commonly', 'frequently', 'sometimes', 'occasionally', 'generally', 'typically',
  'largely', 'primarily', 'predominantly', 'strictly', 'loosely', 'now', 'also',
  'formerly', 'originally'
]);

const EDITORIAL_CONNECTORS = new Set(['or', 'and', '&', '/']);

const EDITORIAL_TAGS = new Set([
  // Grammar / syntax / countability / POS
  'transitive', 'intransitive', 'ambitransitive', 'ditransitive', 'monotransitive',
  'reflexive', 'reciprocal', 'ergative', 'impersonal', 'pronominal', 'copular',
  'auxiliary', 'modal', 'stative', 'causative',
  'countable', 'uncountable', 'count', 'noncount', 'non-count', 'mass',
  'singular', 'plural', 'singular only', 'plural only',
  'in the singular', 'in singular', 'in the plural', 'in plural',
  'plurale tantum', 'singulare tantum',
  'attributive', 'attributively', 'predicative', 'predicatively', 'postpositive',
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'interjection', 'determiner', 'article', 'numeral',
  'participle', 'gerund', 'prefix', 'suffix',
  // Region / dialect
  'us', 'u.s.', 'usa', 'uk', 'u.k.', 'gb', 'au', 'nz', 'ca', 'ie', 'za',
  'sg', 'ph', 'hk', 'ame', 'bre', 'aus',
  'american', 'british', 'australian', 'canadian', 'irish', 'scottish', 'scots',
  'welsh', 'indian', 'south african', 'new zealand', 'caribbean', 'jamaican',
  'philippine', 'singaporean', 'north america', 'north american', 'britain',
  'england', 'scotland', 'ireland', 'australia', 'canada', 'united states',
  'commonwealth', 'northern england', 'southern england', 'midlands', 'cockney',
  'northern irish', 'ulster', 'appalachian', 'new england', 'midwest',
  'midwestern', 'southern us', 'regional', 'dialectal',
  // Register / attitude / frequency
  'formal', 'informal', 'colloquial', 'slang', 'vulgar', 'offensive', 'taboo',
  'euphemistic', 'jocular', 'humorous', 'facetious', 'ironic', 'derogatory',
  'pejorative', 'disparaging', 'literary', 'poetic', 'bookish', 'elevated',
  'familiar', 'casual', 'nonstandard', 'non-standard', 'substandard',
  'proscribed', 'rare', 'uncommon'
]);

const EDITORIAL_MULTIWORD_PATTERNS = [
  'singular only', 'plural only', 'in the singular', 'in singular',
  'in the plural', 'in plural', 'plurale tantum', 'singulare tantum',
  'south african', 'new zealand', 'north america', 'north american',
  'united states', 'northern england', 'southern england', 'northern irish',
  'new england', 'southern us', 'non-count', 'non-standard'
].sort((a, b) => b.length - a.length);

function isEditorialSegment(segment) {
  const normalized = segment.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return true;
  if (EDITORIAL_TAGS.has(normalized)) return true;
  let rest = normalized;
  for (const phrase of EDITORIAL_MULTIWORD_PATTERNS) {
    rest = rest.replaceAll(phrase, ' __EDITORIAL_TAG__ ');
  }
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  let hasEditorialTag = false;
  for (const token of tokens) {
    if (token === '__EDITORIAL_TAG__' || EDITORIAL_TAGS.has(token)) {
      hasEditorialTag = true;
      continue;
    }
    if (EDITORIAL_MODIFIERS.has(token) || EDITORIAL_CONNECTORS.has(token)) continue;
    return false;
  }
  return hasEditorialTag;
}

function filterBracketContent(open, inner, close) {
  const trimmed = inner.trim();
  if (!trimmed) return ' ';
  const segments = inner.split(/\s*[,;]\s*/);
  const kept = segments.filter(segment => !isEditorialSegment(segment));
  if (!kept.length) return ' ';
  if (kept.length === segments.length) return `${open}${inner}${close}`;
  return `${open}${kept.map(segment => segment.trim()).filter(Boolean).join(', ')}${close}`;
}

export function meaningComparisonText(value) {
  const raw = String(value || '');
  const stack = [{ open: '', closeExpected: '', content: '' }];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '(' || ch === '[') {
      stack.push({ open: ch, closeExpected: ch === '(' ? ')' : ']', content: '' });
      continue;
    }
    if ((ch === ')' || ch === ']') && stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top.closeExpected === ch) {
        stack.pop();
        stack[stack.length - 1].content += filterBracketContent(top.open, top.content, ch);
        continue;
      }
    }
    stack[stack.length - 1].content += ch;
  }
  while (stack.length > 1) {
    const unclosed = stack.pop();
    stack[stack.length - 1].content += unclosed.open + unclosed.content;
  }
  return stack[0].content.replace(/\s+/g, ' ').replace(/\s+([,;.!?])/g, '$1').trim();
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
