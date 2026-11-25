// Shared pronunciation service: recorded dictionary audio first, then native
// Android text-to-speech, then the browser Web Speech API.

let activeAudio = null;
let activeBrowserSpeech = null;
let nativeSpeakTimer = null;
let speechRequest = 0;
let speakingNow = false;
const speechListeners = new Set();
const preloadedUrls = new Set();

// macOS / OS novelty, joke, and legacy eloquence voices sound robotic/machinery
// and often sort alphabetically ahead of natural human voices like Samantha.
const NOVELTY_OR_ROBOTIC_VOICE = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|eddy|flo|fred|good news|grandma|grandpa|jester|junior|kathy|organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox|espeak|compact|robot)\b/i;

const PREMIUM_VOICE_PATTERN = /\b(natural|premium|enhanced|neural|siri|online)\b|google\s+(us|uk)\s+english/i;

const QUALITY_HUMAN_VOICE = /\b(samantha|alex|ava|allison|zoe|nicky|aaron|evan|nathan|susan|tom|victoria|daniel|karen|moira|tessa|serena|kate|oliver|martha|arthur|aria|jenny|guy|christopher|michelle|steffan|lesya)\b/i;

function browserWindow() {
  return typeof window === 'undefined' ? null : window;
}

function emitSpeechState(speaking, detail = {}) {
  const next = Boolean(speaking);
  if (next === speakingNow && !next) return;
  speakingNow = next;
  const payload = { speaking: next, ...detail };
  for (const listener of [...speechListeners]) {
    try { listener(payload); } catch { /* listener errors must not break speech */ }
  }
  if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
    globalThis.dispatchEvent(new CustomEvent('keepvocab:speech-state', { detail: payload }));
  }
}

export function isSpeechActive() {
  return speakingNow;
}

export function onSpeechStateChange(listener) {
  if (typeof listener !== 'function') return () => {};
  speechListeners.add(listener);
  return () => speechListeners.delete(listener);
}

export function preloadSpeechVoices() {
  const synth = browserWindow()?.speechSynthesis;
  if (!synth?.getVoices) return [];
  return synth.getVoices() || [];
}

export function preloadAudioUrl(url) {
  const cleanUrl = String(url || '').trim();
  const targetWindow = browserWindow();
  if (!cleanUrl || preloadedUrls.has(cleanUrl) || typeof targetWindow?.Audio !== 'function') return false;
  try {
    const audio = new targetWindow.Audio(cleanUrl);
    audio.preload = 'auto';
    audio.load?.();
    preloadedUrls.add(cleanUrl);
    if (preloadedUrls.size > 40) {
      const oldest = preloadedUrls.values().next().value;
      if (oldest) preloadedUrls.delete(oldest);
    }
    return true;
  } catch {
    return false;
  }
}

function scoreVoice(voice, requested, language) {
  const voiceLang = String(voice?.lang || '').toLowerCase().replace('_', '-');
  const voiceName = String(voice?.name || '');
  const exactLocale = voiceLang === requested;
  const sameLanguage = exactLocale || voiceLang === language || voiceLang.startsWith(`${language}-`);
  if (!sameLanguage) return -Infinity;

  let score = exactLocale ? 30 : 0;
  if (NOVELTY_OR_ROBOTIC_VOICE.test(voiceName)) {
    score -= 200;
  } else if (PREMIUM_VOICE_PATTERN.test(voiceName)) {
    score += 100;
  } else if (QUALITY_HUMAN_VOICE.test(voiceName)) {
    score += 65;
  } else {
    score += 20;
  }
  if (voice?.default) score += 4;
  return score;
}

export function selectLocaleVoice(voices = [], lang = 'en-US') {
  const requested = String(lang || 'en-US').toLowerCase().replace('_', '-');
  const language = requested.split('-')[0];
  let best = null;
  let bestScore = -Infinity;
  for (const voice of Array.isArray(voices) ? voices : []) {
    const score = scoreVoice(voice, requested, language);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return bestScore > -Infinity ? best : null;
}

function nativeSpeechPlugin(targetWindow) {
  const capacitor = targetWindow?.Capacitor;
  if (!capacitor || capacitor.getPlatform?.() !== 'android') return null;
  if (capacitor.Plugins?.NativeSpeech) return capacitor.Plugins.NativeSpeech;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('NativeSpeech');
  return null;
}

export function stopSpeech() {
  speechRequest += 1;
  const targetWindow = browserWindow();
  if (nativeSpeakTimer) {
    globalThis.clearTimeout(nativeSpeakTimer);
    nativeSpeakTimer = null;
  }
  if (activeAudio) {
    const current = activeAudio;
    current.element.pause();
    current.element.removeAttribute?.('src');
    current.element.load?.();
    current.finish(false);
  }
  if (activeBrowserSpeech) {
    const current = activeBrowserSpeech;
    activeBrowserSpeech = null;
    current.finish(false);
  }
  const synth = targetWindow?.speechSynthesis;
  if (synth && (synth.speaking || synth.pending)) {
    synth.cancel?.();
  }
  nativeSpeechPlugin(targetWindow)?.stop?.().catch?.(() => {});
  emitSpeechState(false);
}

// Keep natural studio speed (1.0) on recorded human audio unless Slow mode
// is explicitly requested, avoiding WebAudio/HTML5 time-stretch distortion.
function recordedPlaybackRate(rate) {
  const numeric = Number(rate);
  if (!Number.isFinite(numeric) || numeric >= 0.85) return 1;
  return Math.max(0.65, Math.min(0.84, numeric));
}

async function playRecordedAudio(url, rate, text) {
  const targetWindow = browserWindow();
  if (!url || typeof targetWindow?.Audio !== 'function') return false;
  return new Promise(resolve => {
    const audio = new targetWindow.Audio(url);
    const playbackRate = recordedPlaybackRate(rate);
    audio.playbackRate = playbackRate;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
    audio.preload = 'auto';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (activeAudio?.element === audio) activeAudio = null;
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      emitSpeechState(false);
      resolve(result);
    };
    activeAudio = { element: audio, finish };
    audio.onplaying = () => emitSpeechState(true, { text, slow: playbackRate < 0.85 });
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    emitSpeechState(true, { text, slow: playbackRate < 0.85 });
    try { Promise.resolve(audio.play()).catch(() => finish(false)); }
    catch { finish(false); }
  });
}

async function speakNatively(text, lang, rate, request) {
  const plugin = nativeSpeechPlugin(browserWindow());
  if (!plugin?.speak) return false;
  try {
    emitSpeechState(true, { text, slow: rate < 0.85 });
    await plugin.speak({ text, lang, rate });
    if (request === speechRequest) {
      const estimatedMs = Math.max(850, Math.min(4800, Math.round((text.length * 72 + 450) / Math.max(0.6, Number(rate) || 0.95))));
      nativeSpeakTimer = globalThis.setTimeout(() => {
        nativeSpeakTimer = null;
        if (request === speechRequest) emitSpeechState(false);
      }, estimatedMs);
    }
    return true;
  } catch (error) {
    emitSpeechState(false);
    console.warn('[SpeechService] Native speech failed; using browser fallback.', error);
    return false;
  }
}

function waitForVoices(synthesizer, timeoutMs = 2400) {
  const voices = synthesizer.getVoices?.() || [];
  if (voices.length) return Promise.resolve(voices);
  return new Promise(resolve => {
    let settled = false;
    const startedAt = Date.now();
    let pollTimer = null;
    let timeoutTimer = null;
    const finish = () => {
      if (settled) return;
      const current = synthesizer.getVoices?.() || [];
      if (!current.length && Date.now() - startedAt < timeoutMs) return;
      settled = true;
      synthesizer.removeEventListener?.('voiceschanged', finish);
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(current);
    };
    synthesizer.addEventListener?.('voiceschanged', finish, { once: true });
    pollTimer = setInterval(finish, 120);
    timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      synthesizer.removeEventListener?.('voiceschanged', finish);
      if (pollTimer) clearInterval(pollTimer);
      resolve(synthesizer.getVoices?.() || []);
    }, timeoutMs);
  });
}

async function speakInBrowser(text, lang, rate, request) {
  const targetWindow = browserWindow();
  if (!targetWindow?.speechSynthesis || typeof targetWindow.SpeechSynthesisUtterance !== 'function') return false;
  const voices = await waitForVoices(targetWindow.speechSynthesis);
  if (request !== speechRequest) return false;
  const voice = selectLocaleVoice(voices, lang);
  if (!voice && voices.length) return false;
  const utterance = new targetWindow.SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang || lang;
  utterance.rate = Math.max(0.65, Math.min(1.2, Number(rate) || 0.95));
  utterance.pitch = 1;
  if (voice) utterance.voice = voice;
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (activeBrowserSpeech?.utterance === utterance) activeBrowserSpeech = null;
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
      emitSpeechState(false);
      resolve(result);
    };
    activeBrowserSpeech = { utterance, finish };
    utterance.onstart = () => emitSpeechState(true, { text, slow: utterance.rate < 0.85 });
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    emitSpeechState(true, { text, slow: utterance.rate < 0.85 });
    try { targetWindow.speechSynthesis.speak(utterance); }
    catch { finish(false); }
  });
}

export async function speakWord(text, lang = 'en-US', rate = 0.95, audioUrl = '') {
  return speakText(text, { locale: lang, rate, audioUrl });
}

export async function speakText(text, { locale = 'en-US', rate = 0.95, audioUrl = '' } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return false;
  stopSpeech();
  const request = speechRequest;

  if (audioUrl && await playRecordedAudio(audioUrl, rate, cleanText)) return request === speechRequest;
  if (request !== speechRequest) return false;
  if (await speakNatively(cleanText, locale, rate, request)) return request === speechRequest;
  if (request !== speechRequest) return false;
  return speakInBrowser(cleanText, locale, rate, request);
}
