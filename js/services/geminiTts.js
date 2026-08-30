import {
  DEFAULT_GEMINI_TTS_MODEL,
  DEFAULT_GEMINI_TTS_VOICE,
  generateGeminiParts,
  getGeminiSettings,
  isRetryableGeminiError
} from './geminiSettings.js?v=117';
import { base64ToBytes } from '../utils/base64.js?v=117';

export { DEFAULT_GEMINI_TTS_MODEL, DEFAULT_GEMINI_TTS_VOICE };
export const DEFAULT_DIALOGUE_VOICES = Object.freeze([
  { speaker: 'Rasa', voice: 'Achird' },
  { speaker: 'Mantas', voice: 'Puck' }
]);
const DB_NAME = 'keepvocab_disposable_audio_v1';
const STORE_NAME = 'tts';
const AUDIO_CACHE_LIMIT = 160;

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
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function writeCachedBlob(key, blob, indexedDb) {
  const db = await openAudioDb(indexedDb);
  if (!db) return false;
  return new Promise(resolve => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put({ key, blob, cachedAt: new Date().toISOString() });
    const all = store.getAll();
    all.onsuccess = () => {
      const expired = (all.result || [])
        .sort((a, b) => String(b.cachedAt || '').localeCompare(String(a.cachedAt || '')))
        .slice(AUDIO_CACHE_LIMIT);
      expired.forEach(item => store.delete(item.key));
    };
    transaction.oncomplete = () => { db.close(); resolve(true); };
    transaction.onerror = () => { db.close(); resolve(false); };
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

function inlineAudioBlob(part) {
  const inline = part?.inlineData || part?.inline_data;
  if (!inline?.data) return null;
  const mimeType = String(inline.mimeType || inline.mime_type || 'audio/L16;rate=24000');
  const bytes = base64ToBytes(inline.data);
  if (/wav|mpeg|mp3|ogg|webm/i.test(mimeType)) return new Blob([bytes], { type: mimeType });
  const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1] || 24000);
  return new Blob([pcm16ToWavBytes(bytes, rate)], { type: 'audio/wav' });
}

function interactionAudioBlob(payload) {
  const direct = payload?.output_audio || payload?.outputAudio;
  const content = direct?.data ? direct : (payload?.steps || []).flatMap(step => step?.content || []).find(item => item?.type === 'audio' && item?.data);
  if (!content?.data) return null;
  const mimeType = String(content.mime_type || content.mimeType || 'audio/wav');
  const bytes = base64ToBytes(content.data);
  if (/wav|mpeg|mp3|ogg|webm|aac|flac/i.test(mimeType)) return new Blob([bytes], { type: mimeType });
  const rate = Number(content.sample_rate || content.sampleRate || mimeType.match(/rate=(\d+)/i)?.[1] || 24000);
  return new Blob([pcm16ToWavBytes(bytes, rate)], { type: 'audio/wav' });
}

export function buildMultiSpeakerTtsRequest(transcript, voices = DEFAULT_DIALOGUE_VOICES, model = DEFAULT_GEMINI_TTS_MODEL) {
  const lines = (transcript || []).map(turn => `${String(turn?.speaker || '').trim()}: ${String(turn?.text || '').trim()}`).filter(line => !/^:\s*$/.test(line));
  const speakers = uniqueSpeakerVoices(transcript, voices);
  return {
    model,
    input: `Perform this Lithuanian learner dialogue at a clear, natural pace. Read only the named transcript lines. Keep each character's assigned voice consistent.\n\n${lines.join('\n')}`,
    response_format: { type: 'audio' },
    generation_config: { speech_config: speakers.map(item => ({ speaker: item.speaker, voice: item.voice })) }
  };
}

function uniqueSpeakerVoices(transcript, voices) {
  const supplied = new Map((voices || []).map(item => [String(item?.speaker || '').trim(), String(item?.voice || '').trim()]));
  const defaults = DEFAULT_DIALOGUE_VOICES.map(item => item.voice);
  const speakers = [...new Set((transcript || []).map(turn => String(turn?.speaker || '').trim()).filter(Boolean))].slice(0, 2);
  return speakers.map((speaker, index) => ({ speaker, voice: supplied.get(speaker) || defaults[index % defaults.length] }));
}

export async function getCachedOrGenerateDialogueAudio(transcript, { voices = DEFAULT_DIALOGUE_VOICES, storage = globalThis.localStorage, indexedDb = globalThis.indexedDB, fetchImpl = globalThis.fetch } = {}) {
  const cleanTranscript = (transcript || []).map(turn => ({ speaker: String(turn?.speaker || '').trim(), text: String(turn?.text || '').trim() })).filter(turn => turn.speaker && turn.text);
  if (cleanTranscript.length < 2 || new Set(cleanTranscript.map(turn => turn.speaker)).size < 2) return null;
  const settings = getGeminiSettings(storage);
  const selectedVoices = uniqueSpeakerVoices(cleanTranscript, voices);
  const key = `dialogue-v1|${settings.ttsModel}|${selectedVoices.map(item => `${item.speaker}:${item.voice}`).join('|')}|${cleanTranscript.map(turn => `${turn.speaker}:${turn.text}`).join('|')}`.toLocaleLowerCase('lt-LT');
  const cached = await readCachedBlob(key, indexedDb).catch(() => null);
  if (cached) return URL.createObjectURL(cached);
  if (!settings.apiKey || !fetchImpl || globalThis.navigator?.onLine === false) return null;
  const request = buildMultiSpeakerTtsRequest(cleanTranscript, selectedVoices, settings.ttsModel || DEFAULT_GEMINI_TTS_MODEL);
  let response;
  try {
    response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(request)
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error('Gemini dialogue audio request failed.');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch {}
    throw new Error(`Gemini dialogue audio failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }
  const blob = interactionAudioBlob(await response.json());
  if (!blob) return null;
  await writeCachedBlob(key, blob, indexedDb).catch(() => false);
  return URL.createObjectURL(blob);
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
  // A bare short word can be rejected by the speech classifier as vague. The
  // explicit transcript boundary keeps the request classified as speech while
  // telling the model not to narrate or paraphrase the instruction.
  const speechPrompt = `Generate speech for the Lithuanian transcript below. Read only the transcript, exactly as written. Do not translate, explain, or add words.\n\nTranscript:\n${clean}`;
  const request = () => generate([{ text: speechPrompt }], {
    storage,
    model: settings.ttsModel || DEFAULT_GEMINI_TTS_MODEL,
    responseModalities: ['AUDIO'],
    generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } } },
    returnParts: true,
    timeoutMs: 20_000
  });
  let parts;
  try { parts = await request(); }
  catch (error) {
    if (!isRetryableGeminiError(error)) throw error;
    parts = await request();
  }
  const blob = (parts || []).map(inlineAudioBlob).find(Boolean) || null;
  if (!blob) return null;
  await writeCachedBlob(key, blob, indexedDb).catch(() => false);
  return URL.createObjectURL(blob);
}
