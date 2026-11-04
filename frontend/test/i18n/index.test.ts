import { getLocales } from 'expo-localization';

import Storage from 'expo-sqlite/kv-store';

import { detectLanguage, storedLanguage } from '@/i18n';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));

const mockLocales = (...codes: (string | null)[]) =>
  jest.mocked(getLocales).mockReturnValue(codes.map((languageCode) => ({ languageCode })) as never);

describe('detectLanguage', () => {
  it.each([
    { name: 'a supported device language', codes: ['ja'], expected: 'ja' },
    { name: 'the first supported language in order', codes: ['de', 'fr', 'ja'], expected: 'fr' },
    { name: 'English when none is supported', codes: ['de', null], expected: 'en' },
    { name: 'English when the device reports no locale', codes: [], expected: 'en' },
  ])('returns $name', ({ codes, expected }) => {
    mockLocales(...codes);

    expect(detectLanguage()).toBe(expected);
  });
});

describe('storedLanguage (BR-SET-01)', () => {
  it.each([
    { name: 'the language the user chose', stored: 'fr', expected: 'fr' },
    { name: 'null before the user chooses one', stored: null, expected: null },
    { name: 'null for a value that isn’t a language', stored: 'de', expected: null },
  ])('returns $name', ({ stored, expected }) => {
    if (stored) {
      Storage.setItemSync('lumei.language', stored);
    }

    expect(storedLanguage()).toBe(expected);
  });

  it('opens the app in the language chosen on an earlier launch', () => {
    Storage.setItemSync('lumei.language', 'ja');

    jest.isolateModules(() => {
      expect(require('@/i18n').default.language).toBe('ja');
    });
  });
});
