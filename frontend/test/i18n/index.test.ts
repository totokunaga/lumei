import { getLocales } from 'expo-localization';

import { detectLanguage } from '@/i18n';

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
