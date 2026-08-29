import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_GEMINI_TTS_VOICE,
  generateGeminiParts,
  getGeminiSettings
} from './geminiSettings.js?v=111';

export { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE };
const DB_NAME = 'keepvocab_disposable_audio_v1';
const STORE_NAME = 'tts';

function audioKey(text, locale, voice) {
  return `pronunciation-v2|${locale}|${voice}|${String(text || '').trim().toLocaleLowerCase(locale)}`;
}

function openAudioDb(indexedDb = globalThis.indexedDB) {
  if (!indexedDb) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Audio cache is unavailable.'));
  });
}

async function readCachedBlob(key, indexedDb) {
  const db = await openAudioDb(indexedDb);
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => resolve(null);
  });
}

async function writeCachedBlob(key, blob, indexedDb) {
  const db = await openAudioDb(indexedDb);
  if (!db) return false;
  return new Promise(resolve => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ key, blob, cachedAt: new Date().toISOString() });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
  });
}

export function pcm16ToWavBytes(pcmBytes, sampleRate = 24000, channels = 1) {
  const source = pcmBytes instanceof Uint8Array ? pcmBytes : new Uint8Array(pcmBytes || []);
  const buffer = new ArrayBuffer(44 + source.byteLength);
  const view = new DataView(buffer);
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + source.byteLength, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, source.byteLength, true); new Uint8Array(buffer, 44).set(source);
  return new Uint8Array(buffer);
}

function decodeBase64(value) {
  if (typeof globalThis.atob === 'function') return Uint8Array.from(globalThis.atob(value), character => character.charCodeAt(0));
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function inlineAudioBlob(part) {
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) return null;
  const mimeType = String(inline.mimeType || inline.mime_type || 'audio/L16;rate=24000');
  const bytes = decodeBase64(inline.data);
  if (/wav|mpeg|mp3|ogg|webm/i.test(mimeType)) return new Blob([bytes], { type: mimeType });
  const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1] || 24000);
  return new Blob([pcm16ToWavBytes(bytes, rate)], { type: 'audio/wav' });
}

export async function getCachedOrGenerateTtsAudio(text, { locale = 'lt-LT', voice = '', storage = globalThis.localStorage, indexedDb = globalThis.indexedDB, generate = generateGeminiParts } = {}) {
  const clean = String(text || '').trim();
  if (!clean || !String(locale).toLowerCase().startsWith('lt')) return null;
  const settings = getGeminiSettings(storage);
  const selectedVoice = voice || settings.ttsVoice || DEFAULT_GEMINI_TTS_VOICE;
  const key = audioKey(clean, locale, selectedVoice);
  const cached = await readCachedBlob(key, indexedDb).catch(() => null);
  if (cached) return URL.createObjectURL(cached);
  if (!settings.apiKey || globalThis.navigator?.onLine === false) return null;
  // Supplying only the target text prevents speech models from reading or
  // paraphrasing an English instruction before the Lithuanian phrase.
  const request = () => generate([{ text: clean }], {
    storage,
    model: settings.ttsModel || DEFAULT_GEMINI_TTS_MODEL,
    responseModalities: ['AUDIO'],
    generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } } },
    returnParts: true,
    timeoutMs: 20_000
  });
  let parts;
  try { parts = await request(); }
  catch { parts = await request(); }
  const blob = (parts || []).map(inlineAudioBlob).find(Boolean) || null;
  if (!blob) return null;
  await writeCachedBlob(key, blob, indexedDb).catch(() => false);
  return URL.createObjectURL(blob);
}
