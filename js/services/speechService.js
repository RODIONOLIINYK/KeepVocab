// Shared pronunciation service: recorded dictionary audio first, then native
// Android text-to-speech, then the browser Web Speech API.

let activeAudio = null;
let activeBrowserSpeech = null;
let speechRequest = 0;

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
    try { Promise.resolve(audio.play()).catch(() => finish(false)); }
    catch { finish(false); }
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
    try { targetWindow.speechSynthesis.speak(utterance); }
    catch { finish(false); }
  });
}

export async function speakWord(text, lang = 'en-US', rate = 0.9, audioUrl = '') {
  return speakText(text, { locale: lang, rate, audioUrl });
}

export async function speakText(text, { locale = 'en-US', rate = 0.9, audioUrl = '' } = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return false;
  stopSpeech();
  const request = speechRequest;

  if (audioUrl && await playRecordedAudio(audioUrl, rate)) return request === speechRequest;
  if (request !== speechRequest) return false;
  if (await speakNatively(cleanText, locale, rate)) return request === speechRequest;
  if (request !== speechRequest) return false;
  return speakInBrowser(cleanText, locale, rate, request);
}
