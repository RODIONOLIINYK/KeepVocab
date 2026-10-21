import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js';
import { DEFAULT_GEMINI_TEXT_MODEL, GEMINI_KEY_STORAGE, GEMINI_SETTINGS_STORAGE, GeminiRequestError, generateGeminiContent, getGeminiSettings, isRetryableGeminiError, saveGeminiSettings } from '../js/services/geminiSettings.js';

test('one device-local Gemini key is shared by every AI feature', () => {
  const storage = new MemoryStorage();
  const saved = saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789', textModel: 'gemini-3.1-flash-lite' }, storage);
  assert.equal(saved.apiKey, 'AIza-example-device-key-123456789');
  assert.equal(getGeminiSettings(storage).textModel, 'gemini-3.1-flash-lite');
  assert.ok(storage.getItem(GEMINI_KEY_STORAGE));
  assert.ok(storage.getItem(GEMINI_SETTINGS_STORAGE));
});

test('Gemini settings use a lightweight stable default without requiring a key', () => {
  const settings = getGeminiSettings(new MemoryStorage());
  assert.equal(settings.enabled, false);
  assert.equal(settings.textModel, DEFAULT_GEMINI_TEXT_MODEL);
});

test('identical concurrent Gemini requests share one paid network call but later requests remain fresh', async () => {
  const settings = { apiKey: 'AIza-example-device-key-123456789', textModel: 'gemini-test' };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'shared result' }] } }] }; } };
  };
  const options = { settings, fetchImpl };
  const [first, second] = await Promise.all([
    generateGeminiContent('same prompt', options),
    generateGeminiContent('same prompt', options)
  ]);
  assert.equal(first, 'shared result');
  assert.equal(second, 'shared result');
  assert.equal(calls, 1);
  await generateGeminiContent('same prompt', options);
  assert.equal(calls, 2);
});

test('Gemini retries are limited to transient failures', () => {
  assert.equal(isRetryableGeminiError(new GeminiRequestError('rate limited', 429)), true);
  assert.equal(isRetryableGeminiError(new GeminiRequestError('server error', 503)), true);
  assert.equal(isRetryableGeminiError(new GeminiRequestError('bad key', 401)), false);
  assert.equal(isRetryableGeminiError(new GeminiRequestError('bad request', 400)), false);
});

test('Gemini structured output ignores thought summaries and combines final answer text parts', async () => {
  const result = await generateGeminiContent('Return JSON.', { json: true, settings: { apiKey: 'test-key', textModel: 'gemini-test' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { thought: true, text: 'Check the term before answering.' },
      { text: '```JSON\n{"found":' }, { text: 'true}\n```' }
    ] }, finishReason: 'STOP' }] }) }) });
  assert.deepEqual(result, { found: true });
});

test('token-limited JSON is an explicit incomplete response, never a usable partial entry', async () => {
  for (const parts of [[], [{ text: '{"found":true' }]]) {
    await assert.rejects(generateGeminiContent('Return JSON.', { json: true, settings: { apiKey: 'test-key', textModel: 'gemini-test' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts }, finishReason: 'MAX_TOKENS' }] }) }) }),
    { code: 'MAX_TOKENS' });
  }
});

test('whitespace-only keys are disabled and explicit disabled settings do not make paid requests', async () => {
  const storage = new MemoryStorage();
  storage.setItem(GEMINI_KEY_STORAGE, '   ');
  assert.equal(getGeminiSettings(storage).enabled, false);
  let calls = 0;
  await assert.rejects(generateGeminiContent('Return JSON.', { settings: { apiKey: 'test-key', enabled: false },
    fetchImpl: async () => { calls += 1; } }), /disabled/i);
  assert.equal(calls, 0);
});
