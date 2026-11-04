// Translations for the supported languages (BR-SET-01).
import { getLocales } from 'expo-localization';
import Storage from 'expo-sqlite/kv-store';
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
 * Picks the app language on first launch, before the user chooses one, from
 * the device's preferred languages (BR-SET-01).
 * @returns The first device language the app supports, or `'en'` if none is.
 */
export const detectLanguage = (): Language =>
  getLocales()
    .map((locale) => locale.languageCode)
    .find(isLanguage) ?? 'en';

/** Where the chosen language is kept on the device, for every account on it. */
const LANGUAGE_KEY = 'lumei.language';

/**
 * Reads the language the user chose in the app (BR-SET-01).
 * @returns The stored language, or null if the user never chose one.
 */
export const storedLanguage = (): Language | null => {
  const value = Storage.getItemSync(LANGUAGE_KEY);
  return isLanguage(value) ? value : null;
};

/**
 * Switches the app to a language and remembers it on the device, so the app
 * opens in it next time (BR-SET-01).
 */
export const changeLanguage = async (language: Language): Promise<void> => {
  Storage.setItemSync(LANGUAGE_KEY, language);
  await i18n.changeLanguage(language);
};

/**
 * Gets the language the app is showing now.
 * @returns `'en'`, `'ja'`, or `'fr'`.
 */
export const currentLanguage = (): Language => (isLanguage(i18n.language) ? i18n.language : 'en');

const i18n = createInstance();

i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage() ?? detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
