import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, getCachedOrGenerateTtsAudio, pcm16ToWavBytes } from '../js/services/geminiTts.js';
import { MemoryStorage } from '../js/services/driveSync.js';
import { GeminiRequestError, saveGeminiSettings } from '../js/services/geminiSettings.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('Gemini PCM audio is wrapped in a valid 24 kHz WAV container', () => {
  const wav = pcm16ToWavBytes(new Uint8Array([0, 0, 255, 127]));
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), 'WAVE');
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 24000);
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 4);
});

test('Lithuanian speech uses disposable IndexedDB caching before device fallbacks', () => {
  const tts = readFileSync(resolve(root, 'js/services/geminiTts.js'), 'utf8');
  const speech = readFileSync(resolve(root, 'js/services/speechService.js'), 'utf8');
  assert.match(DEFAULT_GEMINI_TTS_MODEL, /tts/i);
  assert.equal(DEFAULT_GEMINI_TTS_VOICE, 'Achird');
  assert.match(tts, /keepvocab_disposable_audio_v1/);
  assert.match(tts, /pronunciation-v2/);
  assert.match(tts, /responseModalities: \['AUDIO'\]/);
  assert.match(tts, /settings\.ttsVoice/);
  assert.match(speech, /getCachedOrGenerateTtsAudio/);
  assert.match(speech, /speakNatively\(cleanText, locale, rate\)/);
  assert.match(speech, /speakInBrowser\(cleanText, locale, rate\)/);
});

test('Lithuanian TTS retries transient failures once but never repeats a rejected key request', async () => {
  const storage = new MemoryStorage();
  saveGeminiSettings({ apiKey: 'AIza-example-device-key-123456789' }, storage, { silent: true });
  let rejectedCalls = 0;
  await assert.rejects(() => getCachedOrGenerateTtsAudio('Labas', {
    storage,
    indexedDb: null,
    generate: async () => { rejectedCalls += 1; throw new GeminiRequestError('bad key', 401); }
  }), /bad key/);
  assert.equal(rejectedCalls, 1);

  let transientCalls = 0;
  const url = await getCachedOrGenerateTtsAudio('Ačiū', {
    storage,
    indexedDb: null,
    generate: async () => {
      transientCalls += 1;
      if (transientCalls === 1) throw new GeminiRequestError('busy', 503);
      return [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAAAA==' } }];
    }
  });
  assert.equal(transientCalls, 2);
  assert.match(url, /^blob:/);
  URL.revokeObjectURL(url);
});
