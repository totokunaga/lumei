// Translations for the supported languages (BR-SET-01).
import { getLocales } from 'expo-localization';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';

export const resources = {
  en: { translation: en },
  ja: { translation: ja },
  fr: { translation: fr },
} as const;

export type Language = keyof typeof resources;

const isLanguage = (code: string | null | undefined): code is Language =>
  code != null && code in resources;

// detectLanguage returns the first device language the app supports, or English.
export const detectLanguage = (): Language =>
  getLocales()
    .map((locale) => locale.languageCode)
    .find(isLanguage) ?? 'en';

const i18n = createInstance();

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
