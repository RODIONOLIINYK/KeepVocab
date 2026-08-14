import { generateGeminiContent, generateGeminiParts, getGeminiSettings } from './geminiSettings.js';

const OPENVERSE_API = 'https://api.openverse.org/v1/images/';
const PEXELS_API = 'https://api.pexels.com/v1/search';
const IMAGE_PROVIDER_SETTINGS_KEY = 'keepvocab_image_provider_v1';
const memoryCache = new Map();
const STOP_WORDS = new Set(['about', 'after', 'again', 'also', 'another', 'because', 'being', 'capable', 'could', 'does', 'every', 'from', 'have', 'into', 'more', 'most', 'other', 'someone', 'something', 'that', 'their', 'there', 'these', 'they', 'thing', 'this', 'those', 'very', 'what', 'when', 'where', 'which', 'while', 'with', 'would']);
const LOW_VALUE_PATTERN = /\b(worksheet|diagram|chart|graph|logo|icon|symbol|map|flag|screenshot|advertisement|tv ad|book cover|word cloud|infographic|textbook|presentation|scan|document|microform|caption|poster)\b/i;

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}' -]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values, limit = Infinity) {
  return [...new Set(values.map(normalizeText).filter(Boolean))].slice(0, limit);
}

function uniqueRaw(values, limit = Infinity) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

export function getImageProviderSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(IMAGE_PROVIDER_SETTINGS_KEY) || '{}');
    return { provider: saved.provider === 'pexels' ? 'pexels' : 'openverse', pexelsApiKey: String(saved.pexelsApiKey || '').trim() };
  } catch {
    return { provider: 'openverse', pexelsApiKey: '' };
  }
}

export function saveImageProviderSettings(settings, storage = globalThis.localStorage) {
  const clean = { provider: settings?.provider === 'pexels' ? 'pexels' : 'openverse', pexelsApiKey: String(settings?.pexelsApiKey || '').trim() };
  storage?.setItem(IMAGE_PROVIDER_SETTINGS_KEY, JSON.stringify(clean));
  return clean;
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

// Automatic visual concepts intentionally derive from the selected definition only.
// Dictionary examples often introduce unrelated objects and contexts, so neither the
// spelling, part of speech, nor example sentence may influence these search queries.
export function buildVisualSceneDescriptions(word) {
  const definition = normalizeText(word?.definition);
  const anchor = definitionAnchor(word);
  if (!definition || !anchor) return [];
  const scenes = [];
  scenes.push(anchor);
  if (/\b(person|people|someone|opponent|enemy|worker|leader|child|adult)\b/.test(definition)) {
    scenes.push(`person ${anchor}`, `human situation ${anchor}`);
  } else if (/\b(feeling|emotion|mood|fear|anger|joy|sadness|disgust|contempt)\b/.test(definition)) {
    scenes.push(`human expression ${anchor}`, `real life situation ${anchor}`);
  } else if (/\b(move|moving|make|making|use|using|perform|performing|act|acting|shape|shaping|change|changing|create|creating)\b/.test(definition)) {
    scenes.push(`person ${anchor}`, `visible action ${anchor}`);
  } else {
    scenes.push(`clear visual scene ${anchor}`, `real life situation ${anchor}`);
  }
  return unique(scenes, 4);
}

export async function generateVisualScenesWithGemini(word, options = {}) {
  const prompt = `You create visual memory cues for English learners. Return JSON with a \"scenes\" array containing 3 concise, photograph-searchable scenes for this exact meaning. Derive every scene only from the selected definition below. Do not infer context from the word spelling, part of speech, or any example sentence. Use visible people, objects, actions, states, or concrete metaphors. Avoid written words, typography, logos, diagrams, and generic beauty. Vary literal, situational, and memorable interpretations.\nSelected definition: ${word?.definition || ''}`;
  try {
    const result = await generateGeminiContent(prompt, { ...options, json: true, maxOutputTokens: 220 });
    return unique(Array.isArray(result?.scenes) ? result.scenes : [], 4);
  } catch {
    return [];
  }
}

export function buildVisualSearchQueries(word, { refresh = false } = {}) {
  const custom = normalizeText(word?.imageCustomConcept);
  const concepts = unique(custom ? [custom, ...buildVisualSceneDescriptions(word)] : buildVisualSceneDescriptions(word), 5);
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

export async function findOpenverseImages(concept, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const clean = normalizeText(concept);
  if (!clean || !fetchImpl) return [];
  const cacheKey = `openverse:${clean}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(OPENVERSE_API);
  request.searchParams.set('q', clean); request.searchParams.set('page_size', '40');
  request.searchParams.set('mature', 'false'); request.searchParams.set('category', 'photograph');
  try {
    const response = await fetchImpl(request.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
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
    return [];
  }
}

export async function findPexelsImages(concept, apiKey, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const clean = normalizeText(concept);
  if (!clean || !apiKey || !fetchImpl) return [];
  const cacheKey = `pexels:${clean}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const request = new URL(PEXELS_API);
  request.searchParams.set('query', clean); request.searchParams.set('orientation', 'landscape');
  request.searchParams.set('size', 'medium'); request.searchParams.set('per_page', '30');
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
  const aiScenes = options.aiScenes ? await generateVisualScenesWithGemini(word, options) : [];
  const generated = onlyExtraQueries && extraQueries.length ? [] : buildVisualSearchQueries(word, { refresh });
  const concepts = unique([...extraQueries, ...feedback.preferredConcepts, ...aiScenes, ...generated], 8);
  const excluded = new Set([...(options.excludeUrls || []), ...feedback.rejectedUrls].map(value => String(value || '').trim()).filter(Boolean));
  const seenUrls = new Set(); const seenTitles = new Set(); const collected = [];
  const target = Math.max(limit, options.semanticRerank ? 12 : limit);
  const collect = images => {
    for (const image of images) {
      const titleKey = normalizeText(image.title).replace(/\s+-?\s*(?:op|copy|version)\s*\d+$/i, '').trim();
      if (excluded.has(image.url) || excluded.has(image.sourceUrl) || seenUrls.has(image.url) || seenUrls.has(image.sourceUrl) || seenTitles.has(titleKey)) continue;
      seenUrls.add(image.url); seenUrls.add(image.sourceUrl); seenTitles.add(titleKey); collected.push(image);
      if (collected.length >= target) return true;
    }
    return false;
  };
  if (provider === 'pexels' && pexelsApiKey) for (const concept of concepts) if (collect(await findPexelsImages(concept, pexelsApiKey, fetchImpl))) break;
  if (collected.length < target) for (const concept of concepts) if (collect(rankOpenverseImages(await findOpenverseImages(concept, fetchImpl), concept, 12))) break;
  const ranked = options.semanticRerank ? await rerankImagesWithGemini(word, collected, options) : collected;
  return ranked.slice(0, limit);
}

export const findRelevantCommonsImages = findRelevantImages;
export const rankCommonsImages = rankOpenverseImages;
