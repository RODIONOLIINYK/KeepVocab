export const MAX_BULK_WORDS = 25;

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

export async function lookupBulkWords(terms, lookup, concurrency = 3) {
  const queue = [...terms];
  const results = new Array(queue.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;
      const term = queue[index];
      try {
        results[index] = { term, status: 'ready', data: await lookup(term) };
      } catch (error) {
        results[index] = { term, status: 'manual', error: error instanceof Error ? error.message : String(error) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), queue.length || 1) }, worker));
  return results;
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
