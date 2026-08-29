export const GEMINI_KEY_STORAGE = 'keepvocab_gemini_live_key_v1';
export const GEMINI_SETTINGS_STORAGE = 'keepvocab_google_ai_settings_v1';
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-lite-image-preview';
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
export const LEGACY_GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const DEFAULT_GEMINI_TTS_VOICE = 'Achird';

const inFlightRequests = new Map();
const requestFunctionIds = new WeakMap();
let nextRequestFunctionId = 1;

export class GeminiRequestError extends Error {
  constructor(message, status = 0, cause) {
    super(message, { cause });
    this.name = 'GeminiRequestError';
    this.status = Number(status) || 0;
  }
}

export function isRetryableGeminiError(error) {
  const status = Number(error?.status || 0);
  if (status) return status === 408 || status === 429 || status >= 500;
  return error?.name === 'AbortError' || error?.name === 'TimeoutError' || error instanceof TypeError;
}

function requestFunctionId(fetchImpl, isDefault) {
  if (isDefault) return 'default';
  if (!requestFunctionIds.has(fetchImpl)) requestFunctionIds.set(fetchImpl, nextRequestFunctionId++);
  return requestFunctionIds.get(fetchImpl);
}

function parse(raw, fallback) {
  try { return JSON.parse(raw) || fallback; } catch { return fallback; }
}

function emitChange() {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent('keepvocab:data-changed', { detail: { kind: 'ai-settings' } }));
}

export function getGeminiSettings(storage = globalThis.localStorage) {
  const saved = storage ? parse(storage.getItem(GEMINI_SETTINGS_STORAGE), {}) : {};
  const savedTtsModel = String(saved.ttsModel || '');
  return {
    apiKey: String(storage?.getItem(GEMINI_KEY_STORAGE) || '').trim(),
    textModel: String(saved.textModel || DEFAULT_GEMINI_TEXT_MODEL),
    liveModel: String(saved.liveModel || DEFAULT_GEMINI_LIVE_MODEL),
    imageModel: String(saved.imageModel || DEFAULT_GEMINI_IMAGE_MODEL),
    // TTS is not user-selectable, so older installations can move forward
    // without asking the learner to clear and recreate their settings.
    ttsModel: !savedTtsModel || savedTtsModel === LEGACY_GEMINI_TTS_MODEL ? DEFAULT_GEMINI_TTS_MODEL : savedTtsModel,
    ttsVoice: String(saved.ttsVoice || DEFAULT_GEMINI_TTS_VOICE),
    updatedAt: saved.updatedAt || null,
    enabled: Boolean(storage?.getItem(GEMINI_KEY_STORAGE))
  };
}

export function saveGeminiSettings(input, storage = globalThis.localStorage, options = {}) {
  if (!storage) throw new Error('Device storage is unavailable.');
  const current = getGeminiSettings(storage);
  const apiKey = String(input.apiKey ?? current.apiKey).trim();
  if (apiKey && apiKey.length < 20) throw new Error('That Google AI Studio key looks incomplete.');
  if (apiKey) storage.setItem(GEMINI_KEY_STORAGE, apiKey); else storage.removeItem(GEMINI_KEY_STORAGE);
  const models = {
    textModel: String(input.textModel || current.textModel || DEFAULT_GEMINI_TEXT_MODEL).trim(),
    liveModel: String(input.liveModel || current.liveModel || DEFAULT_GEMINI_LIVE_MODEL).trim(),
    imageModel: String(input.imageModel || current.imageModel || DEFAULT_GEMINI_IMAGE_MODEL).trim(),
    ttsModel: String(input.ttsModel || current.ttsModel || DEFAULT_GEMINI_TTS_MODEL).trim(),
    ttsVoice: String(input.ttsVoice || current.ttsVoice || DEFAULT_GEMINI_TTS_VOICE).trim(),
    updatedAt: input.updatedAt || new Date().toISOString()
  };
  storage.setItem(GEMINI_SETTINGS_STORAGE, JSON.stringify(models));
  if (!options.silent) emitChange();
  return getGeminiSettings(storage);
}

export function clearGeminiSettings(storage = globalThis.localStorage, options = {}) {
  storage?.removeItem(GEMINI_KEY_STORAGE);
  storage?.setItem(GEMINI_SETTINGS_STORAGE, JSON.stringify({
    textModel: DEFAULT_GEMINI_TEXT_MODEL,
    liveModel: DEFAULT_GEMINI_LIVE_MODEL,
    imageModel: DEFAULT_GEMINI_IMAGE_MODEL,
    ttsModel: DEFAULT_GEMINI_TTS_MODEL,
    ttsVoice: DEFAULT_GEMINI_TTS_VOICE,
    updatedAt: new Date().toISOString()
  }));
  if (!options.silent) emitChange();
}

export function getGeminiBackupRecord(storage = globalThis.localStorage) {
  if (!storage?.getItem(GEMINI_SETTINGS_STORAGE) && !storage?.getItem(GEMINI_KEY_STORAGE)) return null;
  const settings = getGeminiSettings(storage);
  return {
    apiKey: settings.apiKey,
    textModel: settings.textModel,
    liveModel: settings.liveModel,
    imageModel: settings.imageModel,
    ttsModel: settings.ttsModel,
    ttsVoice: settings.ttsVoice,
    updatedAt: settings.updatedAt || new Date(0).toISOString()
  };
}

export function restoreGeminiBackupRecord(record, storage = globalThis.localStorage) {
  if (!record || typeof record !== 'object') return getGeminiSettings(storage);
  return saveGeminiSettings({
    apiKey: String(record.apiKey || ''),
    textModel: record.textModel,
    liveModel: record.liveModel,
    imageModel: record.imageModel,
    ttsModel: record.ttsModel,
    ttsVoice: record.ttsVoice,
    updatedAt: record.updatedAt || new Date(0).toISOString()
  }, storage, { silent: true });
}

export async function generateGeminiParts(parts, options = {}) {
  const settings = { ...getGeminiSettings(options.storage), ...(options.settings || {}) };
  if (!settings.apiKey) throw new Error('Add a Google AI Studio key in Settings to use AI feedback.');
  const model = options.model || settings.textModel;
  const defaultFetch = !options.fetchImpl;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error('Network requests are unavailable on this device.');
  const isAudioRequest = Array.isArray(options.responseModalities) && options.responseModalities.includes('AUDIO');
  const configuredMaxOutputTokens = Number(options.maxOutputTokens);
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: Array.isArray(parts) ? parts : [{ text: String(parts || '') }] }],
    generationConfig: {
      ...(options.generationConfig || {}),
      ...(options.json ? { responseMimeType: 'application/json' } : {}),
      ...(options.responseModalities ? { responseModalities: options.responseModalities } : {}),
      // Generated audio can use far more output tokens than its transcript.
      // Let the speech model choose its limit unless one is explicitly set.
      ...(Number.isFinite(configuredMaxOutputTokens) && configuredMaxOutputTokens > 0
        ? { maxOutputTokens: configuredMaxOutputTokens }
        : isAudioRequest ? {} : { maxOutputTokens: 800 })
    }
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const timeoutMs = options.timeoutMs || 20_000;
  const key = `${requestFunctionId(fetchImpl, defaultFetch)}|${url}|${timeoutMs}|${options.returnParts ? 'parts' : options.json ? 'json' : 'text'}|${body}`;
  const execute = async () => {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal || AbortSignal.timeout(timeoutMs),
        body
      });
    } catch (error) {
      throw error instanceof Error ? error : new GeminiRequestError('Gemini request failed.', 0, error);
    }
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error?.message || ''; } catch { /* non-JSON response */ }
      throw new GeminiRequestError(`Gemini request failed (${response.status}).${detail ? ` ${detail}` : ''}`, response.status);
    }
    const payload = await response.json();
    const responseParts = payload?.candidates?.[0]?.content?.parts || [];
    if (options.returnParts) return responseParts;
    const text = responseParts.map(part => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini returned no usable response.');
    if (!options.json) return text;
    try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); } catch { throw new Error('Gemini returned an invalid structured response.'); }
  };
  if (options.dedupe === false) return execute();
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);
  const pending = execute().finally(() => {
    if (inFlightRequests.get(key) === pending) inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, pending);
  return pending;
}

export async function generateGeminiContent(prompt, options = {}) {
  return generateGeminiParts([{ text: String(prompt) }], options);
}

export async function testGeminiSettings(settings, options = {}) {
  const response = await generateGeminiContent('Reply with exactly: KeepVocab ready', { ...options, settings, maxOutputTokens: 20 });
  return /keepvocab ready/i.test(response);
}
