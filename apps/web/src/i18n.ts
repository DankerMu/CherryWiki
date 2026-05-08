import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'cherrywiki.language';

const detector = new LanguageDetector();

detector.addDetector({
  name: 'safeLocalStorage',
  lookup() {
    try {
      return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  cacheUserLanguage(language: string) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(language));
    } catch {
      // Language still changes in memory when storage is unavailable.
    }
  },
});

export function normalizeLanguage(language: string | undefined | null): SupportedLanguage {
  if (language?.toLowerCase().startsWith('en') === true) {
    return 'en';
  }

  return 'zh-CN';
}

export const i18nReady: Promise<void> = i18n
  .use(detector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
    },
    fallbackLng: 'zh-CN',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['safeLocalStorage', 'navigator'],
      caches: ['safeLocalStorage'],
      convertDetectedLanguage: normalizeLanguage,
    },
  })
  .then(() => undefined);

export default i18n;
