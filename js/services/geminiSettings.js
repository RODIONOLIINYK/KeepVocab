export const GEMINI_KEY_STORAGE = 'keepvocab_gemini_live_key_v1';
export const GEMINI_SETTINGS_STORAGE = 'keepvocab_google_ai_settings_v1';
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-lite-image-preview';

function parse(raw, fallback) {
  try { return JSON.parse(raw) || fallback; } catch { return fallback; }
}

function emitChange() {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent('keepvocab:data-changed', { detail: { kind: 'ai-settings' } }));
}

export function getGeminiSettings(storage = globalThis.localStorage) {
  const saved = storage ? parse(storage.getItem(GEMINI_SETTINGS_STORAGE), {}) : {};
  return {
    apiKey: String(storage?.getItem(GEMINI_KEY_STORAGE) || '').trim(),
    textModel: String(saved.textModel || DEFAULT_GEMINI_TEXT_MODEL),
    liveModel: String(saved.liveModel || DEFAULT_GEMINI_LIVE_MODEL),
    imageModel: String(saved.imageModel || DEFAULT_GEMINI_IMAGE_MODEL),
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
    updatedAt: record.updatedAt || new Date(0).toISOString()
  }, storage, { silent: true });
}

export async function generateGeminiParts(parts, options = {}) {
  const settings = { ...getGeminiSettings(options.storage), ...(options.settings || {}) };
  if (!settings.apiKey) throw new Error('Add a Google AI Studio key in Settings to use AI feedback.');
  const model = options.model || settings.textModel;
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error('Network requests are unavailable on this device.');
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: Array.isArray(parts) ? parts : [{ text: String(parts || '') }] }],
      generationConfig: {
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
        ...(options.responseModalities ? { responseModalities: options.responseModalities } : {}),
        maxOutputTokens: options.maxOutputTokens || 800
      }
    })
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch { /* non-JSON response */ }
    throw new Error(`Gemini request failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }
  const payload = await response.json();
  const responseParts = payload?.candidates?.[0]?.content?.parts || [];
  if (options.returnParts) return responseParts;
  const text = responseParts.map(part => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no usable response.');
  if (!options.json) return text;
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '')); } catch { throw new Error('Gemini returned an invalid structured response.'); }
}

export async function generateGeminiContent(prompt, options = {}) {
  return generateGeminiParts([{ text: String(prompt) }], options);
}

export async function testGeminiSettings(settings, options = {}) {
  const response = await generateGeminiContent('Reply with exactly: KeepVocab ready', { ...options, settings, maxOutputTokens: 20 });
  return /keepvocab ready/i.test(response);
}
