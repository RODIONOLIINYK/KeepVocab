export const DEFAULT_TRANSLATION_LANGUAGE = 'en';

export function normalizeTranslationLanguage(value) {
  return value === 'uk' ? 'uk' : DEFAULT_TRANSLATION_LANGUAGE;
}

export function getTranslationLanguage(storage = globalThis.localStorage) {
  try {
    return normalizeTranslationLanguage(JSON.parse(storage?.getItem('keepvocab_settings') || '{}')?.translationLanguage);
  } catch {
    return DEFAULT_TRANSLATION_LANGUAGE;
  }
}

export function isUkrainianTranslationEnabled(storage) {
  return getTranslationLanguage(storage) === 'uk';
}

export function getTranslationName(storage) {
  return isUkrainianTranslationEnabled(storage) ? 'Ukrainian' : 'English';
}
