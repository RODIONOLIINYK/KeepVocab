import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE, pcm16ToWavBytes } from '../js/services/geminiTts.js';

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
