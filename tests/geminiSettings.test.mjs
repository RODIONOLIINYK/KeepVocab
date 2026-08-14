import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from '../js/services/driveSync.js';
import { DEFAULT_GEMINI_TEXT_MODEL, GEMINI_KEY_STORAGE, GEMINI_SETTINGS_STORAGE, getGeminiSettings, saveGeminiSettings } from '../js/services/geminiSettings.js';

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
