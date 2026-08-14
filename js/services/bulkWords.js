export const MAX_BULK_WORDS = 100;
export const BULK_LOOKUP_DELAY_MS = 1000;

export function parseBulkWordList(value, limit = MAX_BULK_WORDS) {
  const seen = new Set();
  return String(value || '')
    .split(/[\n,;]+/)
    .map(item => item.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .filter(item => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(0, limit));
}

const wait = delayMs => delayMs > 0 ? new Promise(resolve => setTimeout(resolve, delayMs)) : Promise.resolve();

function isTransientLookupError(error) {
  return ['NETWORK', 'TIMEOUT', 'HTTP', 'RATE_LIMIT'].includes(String(error?.code || ''));
}

export async function lookupBulkWords(terms, lookup, options = {}) {
  const queue = [...terms].slice(0, MAX_BULK_WORDS);
  const results = [];
  const delayMs = Math.max(0, Number(options.delayMs ?? 0));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 500));
  const retries = Math.max(0, Math.min(3, Number(options.retries ?? 0)));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};

  for (let index = 0; index < queue.length; index += 1) {
    const term = queue[index];
    let attempt = 0;
    let result;
    while (!result) {
      try {
        const data = await lookup(term);
        result = { term, status: 'ready', data };
      } catch (error) {
        if (attempt < retries && isTransientLookupError(error)) {
          attempt += 1;
          await wait(retryDelayMs * attempt);
          continue;
        }
        result = { term, status: 'manual', error: error instanceof Error ? error.message : String(error) };
      }
    }
    results.push(result);
    onProgress({ completed: index + 1, total: queue.length, term, status: result.status });
    if (index < queue.length - 1) await wait(delayMs);
  }
  return results;
}

export async function retryMissingBulkWords(results, lookup, options = {}) {
  const missing = (results || [])
    .map((result, index) => ({ result, index }))
    .filter(item => item.result?.status !== 'ready');
  if (!missing.length) return [...(results || [])];

  const retried = await lookupBulkWords(missing.map(item => item.result.term), lookup, options);
  const merged = [...results];
  missing.forEach((item, retryIndex) => {
    merged[item.index] = {
      ...retried[retryIndex],
      manualDefinition: retried[retryIndex].status === 'ready' ? '' : item.result.manualDefinition || ''
    };
  });
  return merged;
}

export function dedupeBulkResults(results) {
  const seen = new Set();
  return (results || []).filter(result => {
    const key = String(result?.data?.word || result?.term || '').trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function attachImagesSequentially(words, findImages, options = {}) {
  const excluded = new Set((options.excludeUrls || []).filter(Boolean));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const enriched = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = { ...words[index] };
    try {
      const [image] = await findImages(word, { excludeUrls: [...excluded], limit: 1 });
      if (image?.url) {
        Object.assign(word, {
          imageUrl: image.url,
          imageSourceUrl: image.sourceUrl || '',
          imageAttribution: image.attribution || '',
          imageLicense: image.license || '',
          imageSearchQuery: image.searchQuery || ''
        });
        excluded.add(image.url);
        if (image.sourceUrl) excluded.add(image.sourceUrl);
      }
    } catch {
      // Image search is optional: keep the fully defined word if a provider is unavailable.
    }
    enriched.push(word);
    onProgress({ completed: index + 1, total: words.length, word: word.word, found: Boolean(word.imageUrl) });
  }
  return enriched;
}

export function bulkResultToWord(result, senseIndex = 0, manualDefinition = '') {
  if (result?.status === 'ready') {
    const data = result.data || {};
    const senses = Array.isArray(data.senses) && data.senses.length ? data.senses : [data];
    const sense = senses[Math.max(0, Math.min(Number(senseIndex) || 0, senses.length - 1))] || {};
    return {
      word: data.word || result.term,
      phonetic: sense.phonetic || data.phonetic || '',
      audioUrl: sense.audioUrl || data.audioUrl || '',
      partOfSpeech: sense.partOfSpeech || 'unknown',
      definition: sense.definition || '',
      example: sense.example || '',
      exampleSourceUrl: sense.exampleSourceUrl || '',
      exampleAttribution: sense.exampleAttribution || '',
      exampleLicense: sense.exampleLicense || ''
    };
  }
  return {
    word: result?.term || '',
    phonetic: '',
    audioUrl: '',
    partOfSpeech: 'unknown',
    definition: String(manualDefinition || '').trim(),
    example: ''
  };
}
