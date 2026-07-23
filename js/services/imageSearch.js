const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const PEXELS_API = 'https://api.pexels.com/v1/search';
const IMAGE_PROVIDER_SETTINGS_KEY = 'keepvocab_image_provider_v1';
const memoryCache = new Map();
const QUERY_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'another', 'because', 'beauty', 'being', 'could', 'does', 'every', 'from', 'have', 'into', 'more', 'most', 'other', 'someone', 'something', 'that', 'their', 'there', 'these', 'they', 'thing', 'this', 'those', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would'
]);
const LOW_VALUE_PATTERN = /\b(worksheet|diagram|chart|graph|logo|icon|symbol|map|flag|screenshot|advertisement|tv ad|book cover|word cloud|infographic|textbook|presentation|scan|document|microform)\b/i;

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function getImageProviderSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(IMAGE_PROVIDER_SETTINGS_KEY) || '{}');
    return {
      provider: saved.provider === 'pexels' ? 'pexels' : 'openverse',
      pexelsApiKey: String(saved.pexelsApiKey || '').trim()
    };
  } catch {
    return { provider: 'openverse', pexelsApiKey: '' };
  }
}

export function saveImageProviderSettings(settings, storage = globalThis.localStorage) {
  const clean = {
    provider: settings?.provider === 'pexels' ? 'pexels' : 'openverse',
    pexelsApiKey: String(settings?.pexelsApiKey || '').trim()
  };
  storage?.setItem(IMAGE_PROVIDER_SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

export function canonicalVisualTerm(value) {
  return normalizeText(value).replace(/^to\s+/, '').trim();
}

function presentParticiple(value) {
  const term = canonicalVisualTerm(value);
  if (!/^[a-z]+$/.test(term) || term.includes(' ')) return term;
  const irregular = new Map([
    ['be', 'being'], ['die', 'dying'], ['lie', 'lying'], ['run', 'running'], ['sit', 'sitting'], ['swim', 'swimming'], ['tie', 'tying']
  ]);
  if (irregular.has(term)) return irregular.get(term);
  if (/ie$/.test(term)) return `${term.slice(0, -2)}ying`;
  if (/[^e]e$/.test(term)) return `${term.slice(0, -1)}ing`;
  if (/^[a-z]*[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(term) && !/[wxy]$/.test(term)) return `${term}${term.at(-1)}ing`;
  return `${term}ing`;
}

function concreteExampleAnchor(word) {
  const term = canonicalVisualTerm(word?.word);
  const tokens = normalizeText(word?.example)
    .split(' ')
    .filter(token => token.length > 3 && token !== term && !QUERY_STOP_WORDS.has(token));
  return [...new Set(tokens)].slice(0, 3).join(' ');
}

function exampleSupportsMeaning(word) {
  const example = normalizeText(word?.example);
  const definition = normalizeText(word?.definition);
  if (!example || !definition) return false;
  const definitionTokens = definition.split(' ')
    .filter(token => token.length > 4 && !QUERY_STOP_WORDS.has(token) && token !== canonicalVisualTerm(word?.word));
  return definitionTokens.some(token => example.includes(token));
}

function meaningVisualConcepts(word) {
  const term = canonicalVisualTerm(word?.word);
  const definition = normalizeText(word?.definition);
  const meaning = `${term} ${definition}`;

  if (/\b(idiot|stupid|foolish|unintelligent|silly person|lacking intelligence)\b/.test(meaning)) {
    return ['silly face', 'confused expression', 'person making mistake'];
  }
  if (/\b(tempo|meter|musical passage|rhythm)\b/.test(definition)) {
    return ['orchestra conductor', 'musicians performing', 'classical orchestra'];
  }
  if (/\b(organism|breeding|propagation|procreation|reproduction|produces others of its kind)\b/.test(definition)) {
    return ['mother duck ducklings', 'animal family', 'seedlings growing'];
  }
  if (/\b(lasting for a very short time|short-lived|fleeting|transitory)\b/.test(definition)) {
    return ['cherry blossoms', 'melting ice', 'soap bubble'];
  }
  if (/\b(increase|increasing|make larger|augmentation|amplification|enlargement|escalation|rising)\b/.test(definition)) {
    return ['inflating balloon', 'hot air balloon inflation', 'balloon growing larger'];
  }
  return [];
}

function definitionAnchor(word) {
  const term = canonicalVisualTerm(word?.word);
  return [...new Set(normalizeText(word?.definition).split(' ')
    .filter(token => token.length > 3 && token !== term && !QUERY_STOP_WORDS.has(token)))]
    .slice(0, 3).join(' ');
}

export function buildVisualSearchQueries(word, { refresh = false } = {}) {
  const term = canonicalVisualTerm(word?.word);
  if (!term) return [];
  const customConcept = normalizeText(word?.imageCustomConcept);
  const definition = normalizeText(word?.definition);
  const partOfSpeech = normalizeText(word?.partOfSpeech);
  const exampleAnchor = exampleSupportsMeaning(word) ? concreteExampleAnchor(word) : '';
  const meaningAnchor = definitionAnchor(word);
  const concepts = customConcept ? [customConcept, ...meaningVisualConcepts(word)] : meaningVisualConcepts(word);

  if (!concepts.length && (partOfSpeech.includes('verb') || /^to\s+/i.test(String(word?.word || '')))) {
    const action = presentParticiple(term);
    if (meaningAnchor) concepts.push(`${term} ${meaningAnchor}`);
    if (exampleAnchor) concepts.push(exampleAnchor);
    concepts.push(`people ${action}`, `${action} outdoors`, action);
  } else if (!concepts.length) {
    if (exampleAnchor) concepts.push(exampleAnchor);
    if (meaningAnchor) concepts.push(meaningAnchor);
    concepts.push(term);
  }

  const unique = [...new Set(concepts.map(normalizeText).filter(Boolean))];
  return refresh ? [...unique.slice(1), unique[0]].filter(Boolean) : unique;
}

function resultScore(image, concept) {
  const title = normalizeText(image.title);
  const tags = normalizeText((image.tags || []).map(tag => tag?.name || tag).join(' '));
  const searchable = `${title} ${tags}`.trim();
  if (!searchable || LOW_VALUE_PATTERN.test(searchable)) return Number.NEGATIVE_INFINITY;
  const conceptTokens = normalizeText(concept).split(' ').filter(token => token.length > 2);
  let score = title.includes(normalizeText(concept)) ? 40 : 0;
  let overlap = 0;
  for (const token of conceptTokens) {
    if (!searchable.includes(token)) continue;
    overlap += 1;
    score += title.includes(token) ? 9 : 4;
  }
  const requiredOverlap = Math.min(2, conceptTokens.length);
  if (overlap < requiredOverlap) return Number.NEGATIVE_INFINITY;
  if (image.category === 'photograph') score += 4;
  if (Number(image.width) >= 640 && Number(image.height) >= 480) score += 2;
  return score;
}

export function rankOpenverseImages(candidates, concept, limit = 6) {
  const seenTitles = new Set();
  return [...(candidates || [])]
    .map((image, index) => ({ image, index, score: resultScore(image, concept) }))
    .filter(item => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ image }) => {
      const titleKey = normalizeText(image.title).replace(/\s+-?\s*(?:op|copy|version)\s*\d+$/i, '').trim();
      if (seenTitles.has(titleKey)) return false;
      seenTitles.add(titleKey);
      return true;
    })
    .slice(0, limit)
    .map(item => item.image);
}

export async function findOpenverseImages(concept, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const clean = normalizeText(concept);
  if (!clean || !fetchImpl) return [];
  if (memoryCache.has(clean)) return memoryCache.get(clean);
  const request = new URL(OPENVERSE_API);
  request.searchParams.set('q', clean);
  request.searchParams.set('page_size', '20');
  request.searchParams.set('mature', 'false');
  request.searchParams.set('category', 'photograph');
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Openverse image search failed (${response.status}).`);
    const payload = await response.json();
    const result = (payload?.results || []).filter(item => item?.thumbnail && item?.foreign_landing_url).map(item => ({
      url: item.thumbnail,
      sourceUrl: item.foreign_landing_url,
      title: String(item.title || clean),
      attribution: item.creator ? `${item.creator} via Openverse` : `${item.source || 'Openverse'} via Openverse`,
      license: [String(item.license || '').toUpperCase(), item.license_version].filter(Boolean).join(' '),
      licenseUrl: item.license_url || '',
      source: item.source || '',
      category: item.category || '',
      tags: item.tags || [],
      width: item.width,
      height: item.height,
      searchQuery: clean
    }));
    memoryCache.set(clean, result);
    return result;
  } catch {
    memoryCache.set(clean, []);
    return [];
  }
}

export async function findPexelsImages(concept, apiKey, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const clean = normalizeText(concept);
  if (!clean || !apiKey || !fetchImpl) return [];
  const request = new URL(PEXELS_API);
  request.searchParams.set('query', clean);
  request.searchParams.set('orientation', 'landscape');
  request.searchParams.set('size', 'medium');
  request.searchParams.set('per_page', '18');
  try {
    const response = await fetchImpl(request.toString(), {
      headers: { Accept: 'application/json', Authorization: apiKey },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Pexels image search failed (${response.status}).`);
    const payload = await response.json();
    return (payload?.photos || []).filter(photo => photo?.src?.large && photo?.url).map(photo => ({
      url: photo.src.large,
      sourceUrl: photo.url,
      title: String(photo.alt || clean),
      attribution: `${photo.photographer || 'Photographer'} via Pexels`,
      license: 'Pexels License',
      licenseUrl: 'https://www.pexels.com/license/',
      source: 'Pexels',
      category: 'photograph',
      tags: normalizeText(photo.alt).split(' '),
      width: photo.width,
      height: photo.height,
      searchQuery: clean
    }));
  } catch {
    return [];
  }
}

export async function findRelevantImages(word, options = {}) {
  const {
    refresh = false,
    extraQueries = [],
    onlyExtraQueries = false,
    excludeUrls = [],
    fetchImpl = globalThis.fetch?.bind(globalThis),
    limit = 6
  } = options;
  const savedProvider = getImageProviderSettings();
  const provider = options.provider || savedProvider.provider;
  const pexelsApiKey = options.pexelsApiKey ?? savedProvider.pexelsApiKey;
  const generatedQueries = onlyExtraQueries && extraQueries.length ? [] : buildVisualSearchQueries(word, { refresh });
  const concepts = [...new Set([...extraQueries, ...generatedQueries].map(normalizeText).filter(Boolean))];
  const excluded = new Set([...excludeUrls].map(value => String(value || '').trim()).filter(Boolean));
  const seenUrls = new Set();
  const seenTitles = new Set();
  const collected = [];
  const collect = images => {
    for (const image of images) {
      const titleKey = normalizeText(image.title).replace(/\s+-?\s*(?:op|copy|version)\s*\d+$/i, '').trim();
      if (excluded.has(image.url) || excluded.has(image.sourceUrl) || seenUrls.has(image.url) || seenUrls.has(image.sourceUrl) || seenTitles.has(titleKey)) continue;
      seenUrls.add(image.url);
      seenUrls.add(image.sourceUrl);
      seenTitles.add(titleKey);
      collected.push(image);
      if (collected.length >= limit) return true;
    }
    return false;
  };

  if (provider === 'pexels' && pexelsApiKey) {
    for (const concept of concepts) {
      if (collect(await findPexelsImages(concept, pexelsApiKey, fetchImpl))) return collected;
    }
  }
  for (const concept of concepts) {
    const ranked = rankOpenverseImages(await findOpenverseImages(concept, fetchImpl), concept, limit);
    if (collect(ranked)) return collected;
  }
  return collected;
}

// Backwards-compatible names for older installed module graphs during service-worker activation.
export const findRelevantCommonsImages = findRelevantImages;
export const rankCommonsImages = rankOpenverseImages;
