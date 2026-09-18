import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWordEntry, wordEntryToWord } from '../js/services/wordEntry.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { saveGeminiSettings } from '../js/services/geminiSettings.js';

function fixture(aiResult, { configured = true, dictionaryFound = false } = {}) {
  const storage = new MemoryStorage();
  if (configured) saveGeminiSettings({ apiKey: 'test-key-for-entry-fallback-123456789' }, storage, { silent: true });
  const calls = [];
  return { storage, calls, fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.includes('generativelanguage.googleapis.com')) {
      const prompt = JSON.parse(options.body).contents[0].parts[0].text;
      assert.match(prompt, /not valid English or you are uncertain/);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiResult) }] } }] }) };
    }
    if (dictionaryFound) return { ok: true, json: async () => ({ word: 'break the ice', entries: [{ partOfSpeech: 'phrase', senses: [{ definition: 'Make people feel at ease.' }] }] }) };
    return { ok: false, status: 404 };
  } };
}

const valid = { found: true, word: 'break the ice', senses: [{ definition: 'Make people feel more comfortable together.', partOfSpeech: 'phrase', example: 'We played a game to break the ice.' }] };

test('English dictionary misses use Gemini through the shared entry pipeline and cache its suggestion', async () => {
  const options = fixture(valid);
  const entry = await fetchWordEntry(' Break the ice ', 'english', options);
  assert.equal(entry.aiGenerated, true);
  assert.equal(entry.senses[0].definition, valid.senses[0].definition);
  assert.equal(wordEntryToWord(entry).word, 'break the ice');
  assert.equal(wordEntryToWord(entry).translation, valid.senses[0].definition);
  assert.deepEqual(await fetchWordEntry('break the ice', 'english', options), entry);
  assert.equal(options.calls.filter(url => url.includes('generativelanguage')).length, 1);
});

test('English dictionary hits never call Gemini', async () => {
  const options = fixture(valid, { dictionaryFound: true });
  const entry = await fetchWordEntry('break the ice', 'english', options);
  assert.equal(entry.aiGenerated, undefined);
  assert.equal(options.calls.length, 1);
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
  assert.equal(options.storage.getItem('keepvocab_english_ai_entry_cache_v1'), null);
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
