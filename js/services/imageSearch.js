import { generateGeminiContent, generateGeminiParts, getGeminiSettings } from './geminiSettings.js?v=79';

const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const WIKIMEDIA_COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const LIBRARY_OF_CONGRESS_API = 'https://www.loc.gov/photos/';
const NASA_IMAGES_API = 'https://images-api.nasa.gov/search';
const PEXELS_API = 'https://api.pexels.com/v1/search';
const IMAGE_PROVIDER_SETTINGS_KEY = 'keepvocab_image_provider_v1';
const memoryCache = new Map();
const providerCooldownUntil = new Map();
const STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'another', 'because', 'being', 'capable', 'could', 'does', 'every', 'from', 'have', 'into', 'more', 'most', 'other', 'someone', 'something', 'that', 'their', 'there', 'these', 'they', 'thing', 'this', 'those', 'typically', 'unattractively', 'usually', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would']);
const SEARCH_GLUE_WORDS = new Set(['across', 'after', 'along', 'around', 'before', 'beside', 'inside', 'near', 'onto', 'outside', 'through', 'toward', 'under', 'planting', 'entering', 'overlooking', 'standing', 'resting', 'turning', 'raising', 'handing', 'signing', 'watching', 'making', 'searching', 'growing', 'pouring', 'lowering', 'playing', 'directing', 'reviewing', 'organizing', 'inflating', 'adding', 'falling', 'blooming', 'bursting', 'melting', 'sprinting', 'running', 'crossing', 'showing', 'reacting', 'ignoring', 'causing', 'captured']);
const LOW_VALUE_PATTERN = /\b(worksheet|diagram|chart|graph|logo|icon|symbol|map|screenshot|advertisement|tv ad|book cover|word cloud|infographic|textbook|presentation|scan|document|microform|caption|poster|chronicle|periodical|handbook|manual|proceedings)\b|\.(?:pdf|djvu|svg|tiff?)(?:\b|$)/i;
const DEFINITION_FRAGMENT_PATTERN = /\b(meaning of|definition of|refers to|state of|quality of|process of|act of|victory gained through)\b/i;

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values, limit = Infinity) {
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, limit);
}

function uniqueRaw(values, limit = Infinity) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function plainMetadata(value) {
  return String(value?.value || value || '').replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|#39);/g, ' ').replace(/\s+/g, ' ').trim();
}

function providerCoolingDown(provider) {
  return Number(providerCooldownUntil.get(provider) || 0) > Date.now();
}

function coolDownProvider(provider) {
  providerCooldownUntil.set(provider, Date.now() + 30_000);
}

function searchPage(options) {
  return Math.min(20, Math.max(1, Math.floor(Number(options?.page) || 1)));
}

function emitImageSettingsChange() {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent('keepvocab:data-changed', { detail: { kind: 'image-settings' } }));
}

export function getImageProviderSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(IMAGE_PROVIDER_SETTINGS_KEY) || '{}');
    return {
      provider: saved.provider === 'openverse' ? 'openverse' : 'pexels',
      pexelsApiKey: String(saved.pexelsApiKey || '').trim(),
      updatedAt: saved.updatedAt || null
    };
  } catch {
    return { provider: 'pexels', pexelsApiKey: '', updatedAt: null };
  }
}

export function saveImageProviderSettings(settings, storage = globalThis.localStorage, options = {}) {
  const current = getImageProviderSettings(storage);
  const clean = {
    provider: settings?.provider === 'openverse' ? 'openverse' : 'pexels',
    pexelsApiKey: String(settings?.pexelsApiKey ?? current.pexelsApiKey).trim(),
    updatedAt: settings?.updatedAt || new Date().toISOString()
  };
  storage?.setItem(IMAGE_PROVIDER_SETTINGS_KEY, JSON.stringify(clean));
  if (!options.silent) emitImageSettingsChange();
  return clean;
}

export function getImageProviderBackupRecord(storage = globalThis.localStorage) {
  if (!storage?.getItem(IMAGE_PROVIDER_SETTINGS_KEY)) return null;
  return getImageProviderSettings(storage);
}

export function restoreImageProviderBackupRecord(record, storage = globalThis.localStorage) {
  if (!record || typeof record !== 'object') return getImageProviderSettings(storage);
  return saveImageProviderSettings({
    provider: record.provider,
    pexelsApiKey: String(record.pexelsApiKey || ''),
    updatedAt: record.updatedAt || new Date(0).toISOString()
  }, storage, { silent: true });
}

export function canonicalVisualTerm(value) {
  return normalizeText(value).replace(/^to\s+/, '').trim();
}

function presentParticiple(value) {
  const term = canonicalVisualTerm(value);
  if (!/^[a-z]+$/.test(term) || term.includes(' ')) return term;
  const irregular = new Map([['be', 'being'], ['die', 'dying'], ['lie', 'lying'], ['run', 'running'], ['sit', 'sitting'], ['swim', 'swimming'], ['tie', 'tying']]);
  if (irregular.has(term)) return irregular.get(term);
  if (/ie$/.test(term)) return `${term.slice(0, -2)}ying`;
  if (/[^e]e$/.test(term)) return `${term.slice(0, -1)}ing`;
  if (/^[a-z]*[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(term) && !/[wxy]$/.test(term)) return `${term}${term.at(-1)}ing`;
  return `${term}ing`;
}

function meaningfulTokens(value, term = '') {
  return unique(normalizeText(value).split(' ').filter(token => token.length > 3 && token !== term && !STOP_WORDS.has(token)), 5);
}

function definitionAnchor(word) {
  return meaningfulTokens(word?.definition).slice(0, 5).join(' ');
}

// These are camera-ready fallbacks, not clipped dictionary definitions. They cover
// recurring visual meanings when Gemini is unavailable; unknown meanings fall back
// to private search keywords and are not presented as if they were scene ideas.
export function buildVisualSceneDescriptions(word) {
  const definition = normalizeText(word?.definition);
  if (!definition) return [];
  if (/\b(victory|conquest|conquer|captur(?:e|ed)|defeat(?:ed)?)\b/.test(definition)) return [
    'soldier planting flag on captured hilltop',
    'victorious army entering a captured fortress',
    'leader overlooking territory after a battle'
  ];
  if (/\b(thin|bony|malnourished|underweight|skinny|emaciated)\b/.test(definition)) return [
    'very thin person standing in oversized clothes',
    'underweight person with narrow shoulders',
    'skinny stray animal searching for food'
  ];
  if (/\b(stupid|foolish|idiotic|unwise)\b.*\b(person|someone|people)\b/.test(definition)) return [
    'confused person making an obvious mistake in public',
    'person ignoring clear instructions and causing a mess',
    'frustrated group watching someone make a foolish choice'
  ];
  if (/\b(financial institution|holds money|lends money|deposit)\b/.test(definition)) return [
    'customer depositing cash with a teller',
    'teller handing money across a counter',
    'customer signing a loan inside an office'
  ];
  if (/\b(land|ground|shore)\b.*\b(beside|along|next to)\b.*\b(river|stream)\b/.test(definition)) return [
    'people resting on grassy river edge',
    'fisherman standing beside a muddy river',
    'trees growing along a curving river shore'
  ];
  if (/\b(last(?:ing)?|temporary|brief|short time|short-lived|fleeting)\b/.test(definition)) return [
    'soap bubble bursting in sunlight',
    'ice cube melting in a warm hand',
    'flower petals falling moments after blooming'
  ];
  if (/\b(detach|detaching|separation|separating|disconnect|unfasten)\b/.test(definition)) return [
    'carabiner unclipped from a climbing rope',
    'mechanic removing a wheel from a bicycle',
    'person unplugging a cable from a wall socket'
  ];
  if (/\b(move quickly|run on foot|faster than a walk|sprint)\b/.test(definition)) return [
    'athlete sprinting down an outdoor track',
    'person running quickly through a city park',
    'runner crossing a finish line at speed'
  ];
  if (/\b(manage|operate|direct)\b.*\b(business|company|organization)\b/.test(definition)) return [
    'manager directing employees in a busy office',
    'business owner reviewing work with a team',
    'supervisor organizing staff around a table'
  ];
  if (/\b(increase|larger|expand|supplement|augment)\b/.test(definition)) return [
    'person inflating a balloon until it grows',
    'hands adding blocks to a growing tower',
    'person pouring more water into a glass'
  ];
  if (/\b(slow|tempo|meter)\b.*\b(music|passage|orchestra|dramatic)\b/.test(definition)) return [
    'conductor lowering hands before a quiet orchestra',
    'musicians watching a conductor slow the rhythm',
    'orchestra playing slowly under a raised baton'
  ];
  if (/\b(fear|anger|joy|sadness|disgust|contempt|emotion|feeling|mood)\b/.test(definition)) return [
    'close portrait with a strong facial expression',
    'person reacting emotionally during a conversation',
    'two people showing contrasting facial reactions'
  ];
  return [];
}

export function isConcreteVisualScene(scene, word) {
  const clean = normalizeText(scene);
  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length < 5 || tokens.length > 7 || DEFINITION_FRAGMENT_PATTERN.test(clean)) return false;
  const wordTokens = new Set(canonicalVisualTerm(word?.word).split(' ').filter(token => token.length > 2));
  if (tokens.some(token => [...wordTokens].some(wordToken => token === wordToken || (wordToken.length >= 3 && token.startsWith(wordToken) && token.length <= wordToken.length + 4)))) return false;
  const definitionTokens = new Set(meaningfulTokens(word?.definition));
  const overlap = tokens.filter(token => definitionTokens.has(token)).length;
  if (overlap / tokens.length >= 0.55) return false;
  return tokens.filter(token => !definitionTokens.has(token) && !wordTokens.has(token)).length >= 3;
}

export function compactGeneratedScene(scene, maxWords = 7) {
  const words = normalizeText(scene).split(' ').filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  const compact = words.filter(word => !['a', 'an', 'the', 'at', 'in', 'on', 'with', 'under', 'beside', 'along'].includes(word));
  return compact.slice(0, maxWords).join(' ');
}

export function compactVisualSearchQuery(scene) {
  const tokens = normalizeText(scene).split(' ').filter(token => token.length > 2 && !STOP_WORDS.has(token) && !SEARCH_GLUE_WORDS.has(token));
  return unique(tokens, 3).join(' ') || normalizeText(scene);
}

export async function generateVisualScenesWithGemini(word, options = {}) {
  const cacheKey = `gemini-scenes:${normalizeText(word?.word)}:${normalizeText(word?.partOfSpeech)}:${normalizeText(word?.definition)}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const prompt = `Act as a visual director, not a dictionary. Create three literal scenes that could each be captured in one photograph and used to remember the exact English meaning below.

Return only JSON: {\"scenes\":[\"...\",\"...\",\"...\"]}

Hard rules for every scene:
- Exactly 5-7 concrete words: visible subject + observable action + object or setting.
- Write a compact search phrase, not a full sentence. Remove articles and decorative adjectives unless essential.
- Never use the target word, a grammatical form of it, or a clipped/rephrased definition.
- Never write an explanation such as \"victory gained through\", \"the act of\", \"a state of\", or \"a person who is\".
- Show specific people, body language, objects, movement, and surroundings. No invisible ideas.
- No text, captions, logos, diagrams, or symbols floating by themselves.
- The three scenes must be visibly different.

Quality example for \"conquest\": \"soldier planting flag on captured hilltop\".
Bad example: \"victory gained through military force\" because it only repeats the definition.
Quality example for \"disdain\": \"woman turning away with curled lip\".
Bad example: \"feeling that someone is unworthy\" because a camera cannot see it.
Quality example for \"detachment\" meaning physical separation: \"person unplugging cable from wall socket\".
Bad example: \"worker cutting a metal sheet\" because cutting or destroying something is not detaching connected parts.

Target word: ${word?.word || ''}
Part of speech: ${word?.partOfSpeech || ''}
Exact selected definition: ${word?.definition || ''}`;
  try {
    const result = await generateGeminiContent(prompt, { ...options, json: true, maxOutputTokens: 220, timeoutMs: options.timeoutMs || 6000 });
    const scenes = unique(Array.isArray(result?.scenes) ? result.scenes.map(scene => compactGeneratedScene(scene)) : [], 4).filter(scene => isConcreteVisualScene(scene, word)).slice(0, 3);
    memoryCache.set(cacheKey, scenes);
    return scenes;
  } catch {
    return [];
  }
}

export function buildVisualSearchQueries(word, { refresh = false } = {}) {
  const custom = normalizeText(word?.imageCustomConcept);
  const term = canonicalVisualTerm(word?.word);
  const anchors = meaningfulTokens(word?.definition, term);
  const senseQuery = [term, ...anchors.slice(0, 3)].filter(Boolean).join(' ');
  const compactDefinition = anchors.slice(0, 3).join(' ');
  const scenes = buildVisualSceneDescriptions(word);
  const concepts = unique([
    custom,
    ...scenes,
    senseQuery,
    compactDefinition,
    term
  ], 6);
  return refresh && concepts.length > 1 ? [...concepts.slice(1), concepts[0]] : concepts;
}

function resultScore(image, concept) {
  const title = normalizeText(image.title);
  const tags = normalizeText((image.tags || []).map(tag => tag?.name || tag).join(' '));
  const searchable = `${title} ${tags}`.trim();
  if (!searchable || LOW_VALUE_PATTERN.test(searchable)) return Number.NEGATIVE_INFINITY;
  const tokens = normalizeText(concept).split(' ').filter(token => token.length > 2 && !STOP_WORDS.has(token));
  let score = title.includes(normalizeText(concept)) ? 40 : 0;
  let overlap = 0;
  for (const token of tokens) {
    if (!searchable.includes(token)) continue;
    overlap += 1;
    score += title.includes(token) ? 9 : 4;
  }
  if (overlap < Math.min(2, tokens.length)) return Number.NEGATIVE_INFINITY;
  if (image.category === 'photograph') score += 4;
  if (Number(image.width) >= 640 && Number(image.height) >= 480) score += 3;
  return score;
}

export function rankOpenverseImages(candidates, concept, limit = 10) {
  const seenTitles = new Set();
  return [...(candidates || [])]
    .map((image, index) => ({ image, index, score: resultScore(image, concept) }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter(({ image }) => {
      const key = normalizeText(image.title).replace(/\s+-?\s*(?:op|copy|version)\s*\d+$/i, '').trim();
      if (!key || seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .slice(0, limit).map(item => item.image);
}

export async function findOpenverseImages(concept, fetchImpl = globalThis.fetch?.bind(globalThis), options = {}) {
  const clean = normalizeText(concept);
  if (!clean || !fetchImpl || providerCoolingDown('openverse')) return [];
  const page = searchPage(options);
  const cacheKey = `openverse:${clean}:page-${page}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(OPENVERSE_API);
  request.searchParams.set('q', clean); request.searchParams.set('page_size', '40');
  request.searchParams.set('page', String(page));
  request.searchParams.set('mature', 'false'); request.searchParams.set('category', 'photograph');
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Openverse image search failed (${response.status}).`);
    const payload = await response.json();
    const result = (payload?.results || []).filter(item => item?.thumbnail && item?.foreign_landing_url).map(item => ({
      url: item.thumbnail, sourceUrl: item.foreign_landing_url, title: String(item.title || clean),
      attribution: item.creator ? `${item.creator} via Openverse` : `${item.source || 'Openverse'} via Openverse`,
      license: [String(item.license || '').toUpperCase(), item.license_version].filter(Boolean).join(' '), licenseUrl: item.license_url || '',
      source: item.source || 'Openverse', category: item.category || '', tags: item.tags || [], width: item.width, height: item.height,
      searchQuery: clean, imageKind: 'external'
    }));
    memoryCache.set(cacheKey, result);
    return result;
  } catch {
    coolDownProvider('openverse');
    return [];
  }
}

export async function findWikimediaImages(concept, fetchImpl = globalThis.fetch?.bind(globalThis), options = {}) {
  const clean = normalizeText(concept);
  if (!clean || !fetchImpl || providerCoolingDown('wikimedia')) return [];
  const page = searchPage(options);
  const cacheKey = `wikimedia:${clean}:page-${page}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(WIKIMEDIA_COMMONS_API);
  Object.entries({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: clean,
    gsrnamespace: '6', gsrlimit: '40', gsroffset: String((page - 1) * 40), prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1200'
  }).forEach(([key, value]) => request.searchParams.set(key, value));
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Wikimedia Commons image search failed (${response.status}).`);
    const payload = await response.json();
    const result = Object.values(payload?.query?.pages || {}).flatMap(page => {
      const info = page?.imageinfo?.[0];
      if (!info?.thumburl || !info?.descriptionurl || !/^image\/(?:jpeg|png|webp)$/i.test(String(info.mime || ''))) return [];
      const metadata = info.extmetadata || {};
      const title = String(page.title || clean).replace(/^File:/i, '').replace(/_/g, ' ');
      const creator = plainMetadata(metadata.Artist) || plainMetadata(metadata.Credit) || 'Wikimedia Commons contributor';
      const license = plainMetadata(metadata.LicenseShortName) || plainMetadata(metadata.UsageTerms);
      return [{
        url: info.thumburl, sourceUrl: info.descriptionurl, title, attribution: `${creator} via Wikimedia Commons`,
        license, licenseUrl: plainMetadata(metadata.LicenseUrl), source: 'Wikimedia Commons', category: 'photograph',
        tags: normalizeText(`${title} ${plainMetadata(metadata.ImageDescription)} ${plainMetadata(metadata.Categories)}`).split(' '),
        width: info.thumbwidth, height: info.thumbheight, searchQuery: clean, imageKind: 'external'
      }];
    });
    memoryCache.set(cacheKey, result);
    return result;
  } catch {
    coolDownProvider('wikimedia');
    return [];
  }
}

export async function findLibraryOfCongressImages(concept, fetchImpl = globalThis.fetch?.bind(globalThis), options = {}) {
  const clean = normalizeText(concept);
  if (!clean || !fetchImpl || providerCoolingDown('loc')) return [];
  const page = searchPage(options);
  const cacheKey = `loc:${clean}:page-${page}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(LIBRARY_OF_CONGRESS_API);
  request.searchParams.set('q', clean);
  request.searchParams.set('fo', 'json');
  request.searchParams.set('c', '40');
  request.searchParams.set('at', 'results');
  request.searchParams.set('sp', String(page));
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Library of Congress image search failed (${response.status}).`);
    const payload = await response.json();
    const result = (payload?.results || []).flatMap(item => {
      const images = Array.isArray(item?.image_url) ? item.image_url.filter(url => /^https:\/\//i.test(String(url || ''))) : [];
      const url = images[Math.min(2, images.length - 1)] || images.at(-1);
      const sourceUrl = String(item?.id || item?.url || '').replace(/^http:/i, 'https:');
      if (!url || !sourceUrl || item?.access_restricted) return [];
      const contributor = (Array.isArray(item.contributor) ? item.contributor[0] : item.contributor) || item?.item?.creators?.[0]?.title || 'Library of Congress contributor';
      const rights = item?.item?.rights_advisory || item?.item?.rights_information || (Array.isArray(item?.rights) ? item.rights[0] : item?.rights) || '';
      const metadata = [item.title, ...(item.subject || []), ...(item.description || []), ...(item?.item?.subjects || [])].join(' ');
      return [{
        url, sourceUrl, title: String(item.title || clean), attribution: `${contributor} via Library of Congress`,
        license: String(rights), licenseUrl: sourceUrl, source: 'Library of Congress', category: 'photograph',
        tags: normalizeText(metadata).split(' '), width: 1000, height: 700, searchQuery: clean, imageKind: 'external'
      }];
    });
    memoryCache.set(cacheKey, result);
    return result;
  } catch {
    coolDownProvider('loc');
    return [];
  }
}

export async function findNasaImages(concept, fetchImpl = globalThis.fetch?.bind(globalThis), options = {}) {
  const clean = normalizeText(concept);
  if (!clean || !fetchImpl || providerCoolingDown('nasa')) return [];
  const page = searchPage(options);
  const cacheKey = `nasa:${clean}:page-${page}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(NASA_IMAGES_API);
  request.searchParams.set('q', clean);
  request.searchParams.set('media_type', 'image');
  request.searchParams.set('page_size', '40');
  request.searchParams.set('page', String(page));
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`NASA image search failed (${response.status}).`);
    const payload = await response.json();
    const result = (payload?.collection?.items || []).flatMap(item => {
      const data = item?.data?.[0] || {};
      const preview = (item?.links || []).find(link => link?.href && (!link.render || link.render === 'image'))?.href;
      const nasaId = String(data.nasa_id || '').trim();
      if (!preview || !nasaId) return [];
      return [{
        url: preview,
        sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
        title: String(data.title || clean),
        attribution: `${data.center || 'NASA'} via NASA Image and Video Library`,
        license: 'NASA Media Usage Guidelines',
        licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
        source: 'NASA Images',
        category: 'photograph',
        tags: unique([...(Array.isArray(data.keywords) ? data.keywords : [data.keywords]), data.description, data.title], 80),
        width: 1200,
        height: 800,
        searchQuery: clean,
        imageKind: 'external'
      }];
    });
    memoryCache.set(cacheKey, result);
    return result;
  } catch {
    coolDownProvider('nasa');
    return [];
  }
}

export async function findPexelsImages(concept, apiKey, fetchImpl = globalThis.fetch?.bind(globalThis), options = {}) {
  const clean = normalizeText(concept);
  if (!clean || !apiKey || !fetchImpl) return [];
  const page = searchPage(options);
  const cacheKey = `pexels:${clean}:page-${page}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(PEXELS_API);
  request.searchParams.set('query', clean); request.searchParams.set('orientation', 'landscape');
  request.searchParams.set('size', 'medium'); request.searchParams.set('per_page', '30');
  request.searchParams.set('page', String(page));
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json', Authorization: apiKey }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Pexels image search failed (${response.status}).`);
    const payload = await response.json();
    const result = (payload?.photos || []).filter(photo => photo?.src?.large && photo?.url).map(photo => ({
      url: photo.src.large, sourceUrl: photo.url, title: String(photo.alt || clean), attribution: `${photo.photographer || 'Photographer'} via Pexels`,
      license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', source: 'Pexels', category: 'photograph',
      tags: normalizeText(photo.alt).split(' '), width: photo.width, height: photo.height, searchQuery: clean, imageKind: 'external'
    }));
    memoryCache.set(cacheKey, result);
    return result;
  } catch {
    return [];
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return globalThis.btoa(binary);
}

export async function rerankImagesWithGemini(word, candidates, options = {}) {
  if (!getGeminiSettings(options.storage).apiKey || !candidates?.length) return candidates || [];
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return candidates;
  const usable = [];
  for (const [index, candidate] of candidates.slice(0, 8).entries()) {
    try {
      const response = await fetchImpl(candidate.url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size > 4_000_000) continue;
      usable.push({ index, candidate, part: { inlineData: { mimeType: blob.type, data: arrayBufferToBase64(await blob.arrayBuffer()) } } });
    } catch { /* CORS/provider failure keeps deterministic ranking. */ }
  }
  if (!usable.length) return candidates;
  const prompt = `Rank these numbered images as memory cues for the selected definition. Use only that definition and the derived visual scene as the intended meaning. Penalize visible text/logos, ambiguity, irrelevant backgrounds, and duplicates. Prefer one obvious focal concept and semantic clarity over attractiveness. Return JSON: {\"ranking\":[zero-based image numbers best-first]}.\nSelected definition: ${word?.definition || ''}\nDerived scene: ${usable[0]?.candidate?.searchQuery || ''}`;
  try {
    const parts = [{ text: prompt }];
    usable.forEach(({ index, part }) => parts.push({ text: `Image ${index}` }, part));
    const result = await generateGeminiParts(parts, { ...options, json: true, maxOutputTokens: 120 });
    const ranked = (result?.ranking || []).map(Number).filter(Number.isInteger).map(index => candidates[index]).filter(Boolean);
    return [...new Set([...ranked, ...candidates])];
  } catch {
    return candidates;
  }
}

export async function generateMemoryImage(word, concept = '', options = {}) {
  const settings = { ...getGeminiSettings(options.storage), ...(options.settings || {}) };
  const scene = normalizeText(concept) || buildVisualSearchQueries(word)[0];
  if (!scene) throw new Error('Describe a visual idea first.');
  const prompt = `Create a clear, memorable educational illustration for the exact English sense below. Show one obvious focal scene, with no words, letters, logos, captions, or decorative clutter.\nWord sense: ${word?.definition || word?.word}\nVisual scene: ${scene}`;
  const parts = await generateGeminiParts([{ text: prompt }], { ...options, model: settings.imageModel, responseModalities: ['TEXT', 'IMAGE'], returnParts: true, maxOutputTokens: 300 });
  const image = parts.find(part => part.inlineData?.data && part.inlineData?.mimeType?.startsWith('image/'))?.inlineData;
  if (!image) throw new Error('Gemini did not return an image. Try a more concrete scene.');
  return { url: `data:${image.mimeType};base64,${image.data}`, sourceUrl: '', title: `Generated memory image: ${scene}`,
    attribution: 'Generated with Google Gemini', license: '', licenseUrl: '', source: 'Gemini', searchQuery: scene,
    imageKind: 'generated', generatedModel: settings.imageModel, generatedAt: new Date().toISOString(), generatedPrompt: prompt };
}

export function imageFeedbackFor(word) {
  const feedback = word?.imageFeedback && typeof word.imageFeedback === 'object' ? word.imageFeedback : {};
  return {
    rejectedUrls: uniqueRaw([...(feedback.rejectedUrls || []), ...(word?.imageRejectedUrls || [])], 80),
    goodUrls: uniqueRaw(feedback.goodUrls || [], 40), preferredConcepts: unique(feedback.preferredConcepts || [], 20),
    updatedAt: feedback.updatedAt || null
  };
}

export function updateImageFeedback(word, action, image, concept = '') {
  const feedback = imageFeedbackFor(word);
  const url = String(image?.url || image?.sourceUrl || '').trim();
  if (action === 'wrong' && url) feedback.rejectedUrls = uniqueRaw([url, ...feedback.rejectedUrls], 80);
  if (action === 'good' && url) feedback.goodUrls = uniqueRaw([url, ...feedback.goodUrls], 40);
  if (action === 'more-like-this') feedback.preferredConcepts = unique([concept || image?.searchQuery, ...feedback.preferredConcepts], 20);
  feedback.updatedAt = new Date().toISOString();
  return feedback;
}

export async function findRelevantImages(word, options = {}) {
  const { refresh = false, extraQueries = [], onlyExtraQueries = false, fetchImpl = globalThis.fetch?.bind(globalThis), limit = 6 } = options;
  const saved = getImageProviderSettings(options.storage);
  const provider = options.provider || saved.provider;
  const pexelsApiKey = options.pexelsApiKey ?? saved.pexelsApiKey;
  const feedback = imageFeedbackFor(word);
  const aiScenes = options.aiScenes === false ? [] : await generateVisualScenesWithGemini(word, options);
  const generated = onlyExtraQueries && extraQueries.length ? [] : buildVisualSearchQueries(word, { refresh });
  const concepts = unique([...extraQueries, ...feedback.preferredConcepts, ...aiScenes, ...generated], 6);
  const excluded = new Set([...(options.excludeUrls || []), ...feedback.rejectedUrls].map(value => String(value || '').trim()).filter(Boolean));
  const seenUrls = new Set(); const seenTitles = new Set(); const collected = [];
  const target = Math.max(limit, options.semanticRerank ? 12 : limit);
  const page = searchPage(options);
  const collect = images => {
    for (const image of images) {
      const titleKey = normalizeText(image.title).replace(/\s+-?\s*(?:op|copy|version)\s*\d+$/i, '').trim();
      if (excluded.has(image.url) || excluded.has(image.sourceUrl) || seenUrls.has(image.url) || seenUrls.has(image.sourceUrl) || seenTitles.has(titleKey)) continue;
      seenUrls.add(image.url); seenUrls.add(image.sourceUrl); seenTitles.add(titleKey); collected.push(image);
      if (collected.length >= target) return true;
    }
    return false;
  };
  const providers = [
    ...(provider === 'pexels' && pexelsApiKey ? [{ id: 'pexels', trustedOrder: true, search: concept => findPexelsImages(concept, pexelsApiKey, fetchImpl, { page }) }] : []),
    { id: 'openverse', search: concept => findOpenverseImages(concept, fetchImpl, { page }) },
    { id: 'wikimedia', search: concept => findWikimediaImages(concept, fetchImpl, { page }) },
    { id: 'loc', search: concept => findLibraryOfCongressImages(concept, fetchImpl, { page }) },
    { id: 'nasa', search: concept => findNasaImages(concept, fetchImpl, { page }) }
  ];
  const searchConcepts = concepts.slice(0, 3);
  const batches = await Promise.all(providers.flatMap((source, providerIndex) => searchConcepts.map(async (concept, conceptIndex) => {
    const searchQuery = compactVisualSearchQuery(concept);
    const found = await source.search(searchQuery);
    const images = (source.trustedOrder ? found.slice(0, target) : rankOpenverseImages(found, searchQuery, target))
      .map(image => ({ ...image, visualScene: concept }));
    return { providerIndex, conceptIndex, images };
  })));
  const providerBuckets = providers.map(() => []);
  for (const batch of batches.sort((a, b) => a.conceptIndex - b.conceptIndex)) providerBuckets[batch.providerIndex].push(...batch.images);
  while (collected.length < target && providerBuckets.some(bucket => bucket.length)) {
    for (const bucket of providerBuckets) {
      const image = bucket.shift();
      if (image) collect([image]);
      if (collected.length >= target) break;
    }
  }
  const ranked = options.semanticRerank ? await rerankImagesWithGemini(word, collected, options) : collected;
  return ranked.slice(0, limit);
}

export const findRelevantCommonsImages = findRelevantImages;
export const rankCommonsImages = rankOpenverseImages;
