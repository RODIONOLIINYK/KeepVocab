import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js';
import { DEFAULT_GEMINI_TEXT_MODEL, DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, GEMINI_KEY_STORAGE, GEMINI_SETTINGS_STORAGE, GeminiRequestError, generateGeminiContent, getGeminiSettings, isRetryableGeminiError, saveGeminiSettings } from '../js/services/geminiSettings.js';

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
  assert.equal(settings.ttsModel, DEFAULT_GEMINI_TTS_MODEL);
  assert.equal(settings.ttsVoice, DEFAULT_GEMINI_TTS_VOICE);
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
