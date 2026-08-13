// Shared pronunciation service: recorded dictionary audio first, then native
// Android text-to-speech, then the browser Web Speech API.

let activeAudio = null;

function browserWindow() {
  return typeof window === 'undefined' ? null : window;
}

export function selectEnglishVoice(voices = [], lang = 'en-US') {
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
  const targetWindow = browserWindow();
  if (activeAudio) {
    const current = activeAudio;
    current.element.pause();
    current.element.removeAttribute?.('src');
    current.element.load?.();
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

function speakInBrowser(text, lang, rate) {
  const targetWindow = browserWindow();
  if (!targetWindow?.speechSynthesis || typeof targetWindow.SpeechSynthesisUtterance !== 'function') return false;
  const utterance = new targetWindow.SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = rate;
  utterance.pitch = 1;
  const voice = selectEnglishVoice(targetWindow.speechSynthesis.getVoices?.() || [], lang);
  if (voice) utterance.voice = voice;
  targetWindow.speechSynthesis.speak(utterance);
  return true;
}

export async function speakWord(text, lang = 'en-US', rate = 0.9, audioUrl = '') {
  const cleanText = String(text || '').trim();
  if (!cleanText) return false;
  stopSpeech();

  if (audioUrl && await playRecordedAudio(audioUrl, rate)) return true;
  if (await speakNatively(cleanText, lang, rate)) return true;
  if (speakInBrowser(cleanText, lang, rate)) return true;

  console.warn('[SpeechService] No speech synthesizer is available on this device.');
  return false;
}
