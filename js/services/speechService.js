// Shared pronunciation service: recorded dictionary audio first, then native
// Android text-to-speech, then the browser Web Speech API.

let activeAudio = null;
let activeBrowserSpeech = null;
let lastSpeechErrorCode = '';

function browserWindow() {
  return typeof window === 'undefined' ? null : window;
}

export function selectLocaleVoice(voices = [], lang = 'en-US') {
  const requested = String(lang).toLowerCase();
  const language = requested.split('-')[0];
  return voices.find(voice => voice.lang?.toLowerCase() === requested && /natural|premium|enhanced/i.test(voice.name || ''))
    || voices.find(voice => voice.lang?.toLowerCase() === requested)
    || voices.find(voice => voice.lang?.toLowerCase().startsWith(`${language}-`) && /natural|premium|enhanced/i.test(voice.name || ''))
    || voices.find(voice => voice.lang?.toLowerCase().startsWith(language))
    || null;
}

export const selectEnglishVoice = selectLocaleVoice;
export function getLastSpeechErrorCode() { return lastSpeechErrorCode; }

function nativeSpeechPlugin(targetWindow) {
  const capacitor = targetWindow?.Capacitor;
  if (!capacitor || capacitor.getPlatform?.() !== 'android') return null;
  if (capacitor.Plugins?.NativeSpeech) return capacitor.Plugins.NativeSpeech;
  if (typeof capacitor.registerPlugin === 'function') return capacitor.registerPlugin('NativeSpeech');
  return null;
}

export function stopSpeech() {
  const targetWindow = browserWindow();
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
  targetWindow?.speechSynthesis?.cancel();
  nativeSpeechPlugin(targetWindow)?.stop?.().catch?.(() => {});
}

async function playRecordedAudio(url, rate) {
  const targetWindow = browserWindow();
  if (!url || typeof targetWindow?.Audio !== 'function') return false;
  return new Promise(resolve => {
    const audio = new targetWindow.Audio(url);
    audio.playbackRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
    audio.preload = 'auto';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (activeAudio?.element === audio) activeAudio = null;
      audio.onended = null;
      audio.onerror = null;
      resolve(result);
    };
    activeAudio = { element: audio, finish };
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    Promise.resolve(audio.play()).catch(() => finish(false));
  });
}

async function speakNatively(text, lang, rate) {
  const plugin = nativeSpeechPlugin(browserWindow());
  if (!plugin?.speak) return false;
  try {
    await plugin.speak({ text, lang, rate });
    return true;
  } catch (error) {
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
    const finish = () => {
      if (settled) return;
      const current = synthesizer.getVoices?.() || [];
      if (!current.length && Date.now() - startedAt < timeoutMs) return;
      settled = true;
      synthesizer.removeEventListener?.('voiceschanged', finish);
      if (pollTimer) clearInterval(pollTimer);
      resolve(current);
    };
    synthesizer.addEventListener?.('voiceschanged', finish, { once: true });
    pollTimer = setInterval(finish, 120);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      synthesizer.removeEventListener?.('voiceschanged', finish);
      if (pollTimer) clearInterval(pollTimer);
      resolve(synthesizer.getVoices?.() || []);
    }, timeoutMs);
  });
}

export async function getSpeechAvailability(locale = 'en-US') {
  const targetWindow = browserWindow();
  const nativeAvailable = Boolean(nativeSpeechPlugin(targetWindow)?.speak);
  const voices = targetWindow?.speechSynthesis ? await waitForVoices(targetWindow.speechSynthesis) : [];
  const voice = selectLocaleVoice(voices, locale);
  const languageTagFallback = Boolean(targetWindow?.speechSynthesis && typeof targetWindow.SpeechSynthesisUtterance === 'function' && voices.length === 0);
  let geminiConfigured = false;
  if (String(locale).toLowerCase().startsWith('lt')) {
    try {
      const { getGeminiSettings } = await import('./geminiSettings.js?v=111');
      geminiConfigured = Boolean(getGeminiSettings().apiKey);
    } catch { /* settings are optional */ }
  }
  return {
    available: Boolean(voice || nativeAvailable || geminiConfigured || languageTagFallback),
    source: voice ? 'device' : nativeAvailable ? 'android' : geminiConfigured ? 'gemini' : languageTagFallback ? 'browser' : 'none',
    voiceName: voice?.name || '',
    voiceLocale: voice?.lang || '',
    geminiConfigured
  };
}

async function speakInBrowser(text, lang, rate) {
  const targetWindow = browserWindow();
  if (!targetWindow?.speechSynthesis || typeof targetWindow.SpeechSynthesisUtterance !== 'function') return false;
  const voices = await waitForVoices(targetWindow.speechSynthesis);
  const voice = selectLocaleVoice(voices, lang);
  // If voices are explicitly listed, never fall through to a non-Lithuanian
  // default. Some embedded browsers cannot enumerate system voices at all,
  // but still honor the BCP 47 language tag when the utterance is spoken.
  if (String(lang).toLowerCase().startsWith('lt') && !voice && voices.length) return false;
  const utterance = new targetWindow.SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  utterance.pitch = 1;
  if (voice) utterance.voice = voice;
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (activeBrowserSpeech?.utterance === utterance) activeBrowserSpeech = null;
      utterance.onend = null;
      utterance.onerror = null;
      resolve(result);
    };
    activeBrowserSpeech = { utterance, finish };
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    targetWindow.speechSynthesis.speak(utterance);
  });
}

export async function speakWord(text, lang = 'en-US', rate = 0.9, audioUrl = '') {
  return speakText(text, { locale: lang, rate, audioUrl });
}

export async function speakText(text, { locale = 'en-US', rate = 0.9, audioUrl = '' } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return false;
  lastSpeechErrorCode = '';
  stopSpeech();

  if (audioUrl && await playRecordedAudio(audioUrl, rate)) return true;
  if (String(locale).toLowerCase().startsWith('lt')) {
    try {
      const { getCachedOrGenerateTtsAudio } = await import('./geminiTts.js?v=111');
      const generatedUrl = await getCachedOrGenerateTtsAudio(cleanText, { locale });
      if (generatedUrl && await playRecordedAudio(generatedUrl, rate)) {
        URL.revokeObjectURL?.(generatedUrl);
        return true;
      }
      if (generatedUrl) URL.revokeObjectURL?.(generatedUrl);
    } catch (error) {
      lastSpeechErrorCode = /api key not valid|unauthenticated|permission denied|\b40[13]\b/i.test(String(error?.message || '')) ? 'invalid-gemini-key' : 'gemini-unavailable';
      console.warn('[SpeechService] Gemini Lithuanian audio was unavailable; using device speech.', error);
    }
  }
  if (await speakNatively(cleanText, locale, rate)) return true;
  if (await speakInBrowser(cleanText, locale, rate)) return true;

  if (!lastSpeechErrorCode) lastSpeechErrorCode = 'device-unavailable';
  console.warn('[SpeechService] No speech synthesizer is available on this device.');
  return false;
}
