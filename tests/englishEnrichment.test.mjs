import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWordEntry, wordEntryToWord } from '../js/services/wordEntry.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { GEMINI_KEY_STORAGE, saveGeminiSettings } from '../js/services/geminiSettings.js';

function fixture(aiResult, { configured = true, dictionaryFound = false, translationLanguage = 'uk' } = {}) {
  const storage = new MemoryStorage();
  storage.setItem('keepvocab_settings', JSON.stringify({ translationLanguage }));
  if (configured) saveGeminiSettings({ apiKey: 'test-key-for-entry-fallback-123456789' }, storage, { silent: true });
  const calls = [];
  return { storage, calls, fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.match(prompt, /not valid English or you are uncertain/);
      if (translationLanguage === 'uk') assert.match(prompt, /translations must be in Ukrainian \(uk\)/i);
      else assert.doesNotMatch(prompt, /Ukrainian/);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiResult) }] } }] }) };
    }
    if (url.includes('api.mymemory.translated.net')) {
      assert.equal(new URL(url).searchParams.get('langpair'), 'en|uk');
      return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Допомогти людям почуватися невимушено.' } }) };
    }
    if (dictionaryFound) return { ok: true, json: async () => ({ word: 'break the ice', entries: [{ partOfSpeech: 'phrase', senses: [{ definition: 'Make people feel at ease.', examples: ['We played a game to break the ice.'] }] }] }) };
    return { ok: false, status: 404 };
  } };
}

const valid = { found: true, word: 'break the ice', senses: [{ definition: 'Make people feel more comfortable together.', translation: 'Допомогти людям почуватися невимушено.', partOfSpeech: 'phrase', example: 'We played a game to break the ice.' }] };

function geminiPayloadFixture(payloadForRequest, overrides) {
  const options = fixture(valid, overrides);
  const originalFetch = options.fetchImpl;
  const requests = [];
  options.fetchImpl = async (url, request) => {
    if (!url.includes('generativelanguage')) return originalFetch(url, request);
    options.calls.push(url);
    requests.push(JSON.parse(request.body));
    return { ok: true, json: async () => payloadForRequest(requests.length, requests.at(-1)) };
  };
  return { ...options, requests };
}

test('English dictionary misses use Gemini through the shared entry pipeline and cache its suggestion', async () => {
  const options = fixture(valid);
  const entry = await fetchWordEntry(' Break the ice ', 'english', options);
  assert.equal(entry.aiGenerated, true);
  assert.equal(entry.senses[0].definition, valid.senses[0].definition);
  assert.equal(wordEntryToWord(entry).word, 'break the ice');
  assert.equal(wordEntryToWord(entry).translation, valid.senses[0].translation);
  assert.equal(wordEntryToWord(entry).translationLanguage, 'uk');
  assert.deepEqual(await fetchWordEntry('break the ice', 'english', options), entry);
  assert.equal(options.calls.filter(url => url.includes('generativelanguage')).length, 1);
});

test('a Gemini entry is not charged for a second clarity pass before it is shown', async () => {
  const options = fixture({ ...valid, senses: [{ ...valid.senses[0], definition: 'The state or quality of being at ease in company.' }] });
  const entry = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(entry.aiGenerated, true);
  assert.equal(options.calls.filter(url => url.includes('generativelanguage')).length, 1);
});

test('AI fallback groups nearly identical proposed senses with exact source evidence', async () => {
  const first = { ...valid.senses[0], definition: 'Make people feel comfortable together.' };
  const second = { ...first, definition: 'Make people feel comfortable together!' };
  const options = fixture({ ...valid, senses: [first, second] });
  const entry = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(entry.senses.length, 1);
  assert.deepEqual(entry.senses[0].sourceDefinitions, [first.definition, second.definition]);
  assert.equal(options.calls.filter(url => url.includes('generativelanguage')).length, 1);
});

test('a dictionary miss accepts the final Gemini JSON when a thought summary precedes it', async () => {
  const options = geminiPayloadFixture(() => ({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { thought: true, text: 'This is an established idiom.' }, { text: JSON.stringify(valid) }
  ] } }] }));
  const entry = await fetchWordEntry('BREAK THE ICE', 'english', options);
  assert.equal(entry.word, 'break the ice');
  assert.equal(entry.aiGenerated, true);
  assert.equal(entry.senses[0].translation, valid.senses[0].translation);
  assert.equal(options.requests.length, 1);
  assert.deepEqual(options.requests[0].generationConfig.responseSchema.required, ['found', 'senses']);
});

test('a truncated Gemini fallback retries once with more room and caches only the complete validated entry', async () => {
  const options = geminiPayloadFixture(attempt => ({ candidates: [{ finishReason: attempt === 1 ? 'MAX_TOKENS' : 'STOP',
    content: { parts: [{ text: attempt === 1 ? '{"found":true,"word":"break the ice","senses":[' : JSON.stringify(valid) }] } }] }));
  const entry = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(entry.aiGenerated, true);
  assert.equal(options.requests.length, 2);
  assert.ok(options.requests[0].generationConfig.maxOutputTokens >= 2048);
  assert.ok(options.requests[1].generationConfig.maxOutputTokens > options.requests[0].generationConfig.maxOutputTokens);
  assert.deepEqual(options.requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  const cached = JSON.parse(options.storage.getItem('keepvocab_english_ai_entry_cache_v2'));
  assert.equal(Object.values(cached)[0].data.word, 'break the ice');
});

test('persistent truncation stops after one retry and never invents or caches a partial meaning', async () => {
  const options = geminiPayloadFixture(() => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }));
  await assert.rejects(fetchWordEntry('break the ice', 'english', options), { code: 'MAX_TOKENS' });
  assert.equal(options.requests.length, 2);
  assert.equal(options.storage.getItem('keepvocab_english_ai_entry_cache_v2'), null);
});

test('English validation allows apostrophe typography while retaining the exact supplied phrase', async () => {
  for (const [term, returnedWord] of [["DON’T HOLD BACK", "don't hold back"], ["don't hold back", 'don’t hold back']]) {
    const options = fixture({ found: true, word: returnedWord, senses: [{ partOfSpeech: 'phrase',
      definition: 'Do not restrain yourself.', example: "Don't hold back when you speak." }] }, { translationLanguage: 'en' });
    const entry = await fetchWordEntry(term, 'english', options);
    assert.equal(entry.word, term.toLowerCase());
    assert.equal(entry.aiGenerated, true);
  }
});

test('dictionary timeouts still fall back to Gemini when enabled', async () => {
  const options = fixture(valid);
  const originalFetch = options.fetchImpl;
  options.fetchImpl = async (url, request) => {
    if (url.includes('generativelanguage')) return originalFetch(url, request);
    options.calls.push(url);
    throw Object.assign(new Error('Timed out.'), { name: 'AbortError' });
  };
  const entry = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(entry.aiGenerated, true);
  assert.equal(options.calls.filter(url => url.includes('generativelanguage')).length, 1);
});

test('disabled, blank-key, and cancelled lookup paths never start Gemini fallback requests', async () => {
  const blankKey = fixture(valid);
  blankKey.storage.setItem(GEMINI_KEY_STORAGE, '   ');
  const disabled = { ...fixture(valid), settings: { enabled: false } };
  for (const options of [blankKey, disabled]) {
    await assert.rejects(fetchWordEntry('break the ice', 'english', options), { code: 'NOT_FOUND' });
    assert.equal(options.calls.some(url => url.includes('generativelanguage')), false);
  }
  const options = fixture(valid);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchWordEntry('break the ice', 'english', { ...options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(options.calls.length, 0);
});

test('provider errors and malformed JSON are not retried as if a term was missing', async () => {
  const malformed = geminiPayloadFixture(() => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{invalid JSON}' }] } }] }));
  await assert.rejects(fetchWordEntry('break the ice', 'english', malformed), /invalid structured response/i);
  assert.equal(malformed.requests.length, 1);
  for (const status of [401, 403, 429]) {
    const options = fixture(valid);
    const originalFetch = options.fetchImpl;
    let requests = 0;
    options.fetchImpl = async (url, request) => {
      if (!url.includes('generativelanguage')) return originalFetch(url, request);
      requests += 1;
      return { ok: false, status, json: async () => ({ error: { message: 'Provider unavailable.' } }) };
    };
    await assert.rejects(fetchWordEntry('break the ice', 'english', options), { status });
    assert.equal(requests, 1);
  }
});

test('English dictionary hits never call Gemini', async () => {
  const options = fixture(valid, { dictionaryFound: true });
  const entry = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(entry.aiGenerated, undefined);
  assert.equal(options.calls.length, 2);
  assert.equal(options.calls.some(url => url.includes('generativelanguage')), false);
  assert.equal(entry.senses[0].translation, valid.senses[0].translation);
});

test('cached English dictionary meanings are backfilled with Ukrainian translations', async () => {
  const options = fixture(valid);
  options.storage.setItem('keepvocab_dictionary_cache_v4', JSON.stringify({ 'break the ice': {
    cachedAt: Date.now(), data: { word: 'break the ice', source: 'dictionary', senses: [
      { definition: 'Make people feel at ease.', translation: 'Make people feel at ease.', example: 'We played a game to break the ice.' }
    ] }
  } }));
  const result = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(result.source, 'cache');
  assert.equal(result.senses[0].definition, 'Make people feel at ease.');
  assert.equal(result.senses[0].translation, valid.senses[0].translation);
  assert.equal(result.translationLanguage, 'uk');
  assert.equal(options.calls.length, 1);
  assert.match(options.calls[0], /api\.mymemory\.translated\.net/);
});

test('default English dictionary lookup sends no translation requests and keeps the original meaning', async () => {
  const options = fixture(valid, { dictionaryFound: true, translationLanguage: 'en' });
  options.storage.removeItem('keepvocab_settings');
  const result = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(options.calls.length, 1);
  assert.equal(result.translation, result.definition);
  assert.equal(result.translationLanguage, 'en');
});

test('English and Ukrainian AI suggestions use separate cache entries and mode-specific prompts', async () => {
  const english = { ...valid, senses: valid.senses.map(({ translation, ...sense }) => sense) };
  const options = fixture(english, { translationLanguage: 'en' });
  const first = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(first.translation, first.definition);
  assert.equal(first.translationLanguage, 'en');
  assert.equal(options.calls.some(url => url.includes('api.mymemory')), false);
  options.storage.setItem('keepvocab_settings', JSON.stringify({ translationLanguage: 'uk' }));
  // The same model result lacks a translation, so Ukrainian mode must backfill it.
  const second = await fetchWordEntry('break the ice', 'english', { ...options, translationLanguage: 'uk', fetchImpl: async (url, request) => {
    if (url.includes('generativelanguage')) {
      options.calls.push(url);
      assert.match(JSON.parse(request.body).contents[0].parts[0].text, /Ukrainian \(uk\)/);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(english) }] } }] }) };
    }
    return options.fetchImpl(url, request);
  } });
  assert.equal(second.translation, valid.senses[0].translation);
  assert.equal(second.translationLanguage, 'uk');
  assert.equal(options.calls.filter(url => url.includes('generativelanguage')).length, 2);
});

test('invalid input and an unconfigured Gemini never send a fallback request', async () => {
  const options = fixture(valid);
  await assert.rejects(fetchWordEntry('<script>', 'english', options), { code: 'INVALID_WORD' });
  assert.equal(options.calls.length, 0);
  const unconfigured = fixture(valid, { configured: false });
  await assert.rejects(fetchWordEntry('break the ice', 'english', unconfigured), { code: 'NOT_FOUND' });
  assert.equal(unconfigured.calls.length, 2);
});

test('Gemini can reject an unknown English word without creating or caching a meaning', async () => {
  const options = fixture({ found: false, senses: [] });
  await assert.rejects(fetchWordEntry('nonsensicalwordxyz', 'english', options), { code: 'NOT_FOUND' });
  assert.equal(options.storage.getItem('keepvocab_english_ai_entry_cache_v2'), null);
});

test('malformed AI responses and silently corrected terms are not accepted as entries', async () => {
  for (const result of [{ found: true, word: 'break the ice', senses: [] }, { ...valid, word: 'ice' }, { senses: valid.senses }, { found: true, word: 'break the ice', senses: [null, { definition: ' ' }] }]) {
    await assert.rejects(fetchWordEntry('break the ice', 'english', fixture(result)), { code: 'BAD_RESPONSE' });
  }
});

test('explicit Ask Gemini bypasses successful dictionary lookup and cached AI suggestions', async () => {
  const { fetchAiWordEntry } = await import('../js/services/wordEntry.js');
  const options = fixture(valid, { dictionaryFound: true });
  const first = await fetchAiWordEntry('break the ice', 'english', options);
  const second = await fetchAiWordEntry('break the ice', 'english', options);
  assert.equal(first.aiGenerated, true);
  assert.deepEqual(second, first);
  assert.equal(options.calls.length, 2);
  assert.ok(options.calls.every(url => url.includes('generativelanguage.googleapis.com')));
});

test('explicit Ask Gemini without a key explains configuration and sends no request', async () => {
  const { fetchAiWordEntry } = await import('../js/services/wordEntry.js');
  const options = fixture(valid, { configured: false });
  await assert.rejects(fetchAiWordEntry('break the ice', 'english', options), { code: 'AI_NOT_CONFIGURED' });
  assert.equal(options.calls.length, 0);
});
