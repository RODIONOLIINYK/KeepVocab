const TATOEBA_API = 'https://api.tatoeba.org/v1/sentences';
const EXAMPLE_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'another', 'being', 'could', 'does', 'from', 'have', 'into', 'more', 'most', 'other', 'person', 'someone', 'something', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would'
]);
const UNSUITABLE_EXAMPLE = /\b(fuck|fucking|goddamn|bitch|bastard|racial|nigger|fat idiot)\b/i;
const SENSE_PROFILES = [
  {
    definition: /\b(tempo|meter|musical passage|rhythm)\b/i,
    supports: /\b(tempo|meter|music|musical|rhythm|passage|orchestra|melody|chord|beat|composition)\b/i,
    conflicts: /\b(augmented reality|virtual objects?|superimposed|real world)\b/i,
    replacement: word => normalize(word) === 'augment'
      ? 'The composer augmented the theme, lengthening its rhythm into a slower, statelier passage.'
      : ''
  },
  {
    definition: /\b(financial institution|holds money|lends money|lender)\b/i,
    supports: /\b(money|deposit|loan|financial|account|cash|lender|savings)\b/i,
    conflicts: /\b(river|shore|stream|water|embankment)\b/i
  },
  {
    definition: /\b(land beside|river bank|shore|embankment)\b/i,
    supports: /\b(river|shore|stream|water|embankment)\b/i,
    conflicts: /\b(deposit|loan|financial|account|savings)\b/i
  }
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function definitionTokens(sense) {
  return [...new Set(normalize([sense.definition, ...(sense.synonyms || [])].join(' '))
    .split(' ')
    .filter(token => token.length > 3 && !EXAMPLE_STOP_WORDS.has(token)))]
    .slice(0, 12);
}

function containsWord(sentence, word) {
  const escaped = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`\\b${escaped}(?:s|es|ed|ing)?\\b`, 'i').test(normalize(sentence));
}

function senseProfile(sense) {
  const definition = String(sense?.definition || '');
  return SENSE_PROFILES.find(profile => profile.definition.test(definition)) || null;
}

export function hasExampleSenseConflict(word, sense, sentence = sense?.example) {
  const text = String(sentence || '').trim();
  if (!text) return false;
  const profile = senseProfile(sense);
  return Boolean(profile?.conflicts.test(text) && !profile.supports.test(text));
}

export function sanitizeExistingExamples(word, senses) {
  return (senses || []).map(sense => {
    if (!hasExampleSenseConflict(word, sense)) return sense;
    const replacement = senseProfile(sense)?.replacement?.(word) || '';
    return {
      ...sense,
      example: replacement,
      exampleSourceUrl: '',
      exampleAttribution: replacement ? 'KeepVocab sense-checked example' : '',
      exampleLicense: ''
    };
  });
}

function exampleScore(candidate, sense, word, requireMeaningEvidence = false) {
  const text = String(candidate.text || '').trim();
  if (!text || UNSUITABLE_EXAMPLE.test(text) || !containsWord(text, word)) return Number.NEGATIVE_INFINITY;
  const normalized = normalize(text);
  const wordCount = normalized.split(' ').filter(Boolean).length;
  if (wordCount < 4 || wordCount > 20) return Number.NEGATIVE_INFINITY;
  let score = 20;
  if (wordCount >= 6 && wordCount <= 14) score += 5;
  if (/^[A-Z].*[.!?]$/.test(text)) score += 2;
  if (!candidate.is_unapproved) score += 2;
  let meaningEvidence = 0;
  for (const token of definitionTokens(sense)) {
    if (!normalized.includes(token)) continue;
    meaningEvidence += 1;
    score += 7;
  }
  const profile = senseProfile(sense);
  if (profile?.conflicts.test(text) && !profile.supports.test(text)) return Number.NEGATIVE_INFINITY;
  if (profile?.supports.test(text)) {
    meaningEvidence += 1;
    score += 14;
  }
  if (requireMeaningEvidence && meaningEvidence === 0) return Number.NEGATIVE_INFINITY;
  if (/\b(Tom|Mary|John|Robert|Dan|Ziri)\b/.test(text)) score -= 3;
  return score;
}

export function assignExamplesToSenses(word, senses, candidates) {
  const used = new Set();
  const cleanedSenses = sanitizeExistingExamples(word, senses);
  const requireMeaningEvidence = cleanedSenses.length > 1;
  return cleanedSenses.map(sense => {
    if (String(sense.example || '').trim()) return sense;
    const ranked = (candidates || [])
      .filter(candidate => !used.has(candidate.id))
      .map(candidate => ({ candidate, score: exampleScore(candidate, sense, word, requireMeaningEvidence) }))
      .filter(item => Number.isFinite(item.score))
      .sort((left, right) => right.score - left.score);
    const selected = ranked[0]?.candidate;
    if (!selected) return sense;
    used.add(selected.id);
    return {
      ...sense,
      example: String(selected.text || '').trim(),
      exampleSourceUrl: `https://tatoeba.org/en/sentences/show/${selected.id}`,
      exampleAttribution: selected.owner ? `${selected.owner} via Tatoeba` : 'Tatoeba',
      exampleLicense: selected.license || ''
    };
  });
}

export async function fetchExamplesForSenses(word, senses, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const cleanedSenses = sanitizeExistingExamples(word, senses);
  if (!fetchImpl || !cleanedSenses.some(sense => !String(sense.example || '').trim())) return cleanedSenses;
  const request = new URL(TATOEBA_API);
  request.searchParams.set('lang', 'eng');
  request.searchParams.set('q', String(word || '').trim());
  request.searchParams.set('sort', 'relevance');
  request.searchParams.set('word_count', '5-18');
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return cleanedSenses;
    const payload = await response.json();
    return assignExamplesToSenses(word, cleanedSenses, Array.isArray(payload?.data) ? payload.data : []);
  } catch {
    return cleanedSenses;
  }
}
