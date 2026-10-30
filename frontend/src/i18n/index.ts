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

/**
 * Checks whether a device language code is one the app is translated into.
 * @returns True for `'en'`, `'ja'`, or `'fr'`, which also narrows the type to `Language`.
 */
const isLanguage = (code: string | null | undefined): code is Language =>
  code != null && code in resources;

/**
 * Picks the app language on first launch from the device's preferred
 * languages (BR-SET-01).
 * @returns The first device language the app supports, or `'en'` if none is.
 */
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
