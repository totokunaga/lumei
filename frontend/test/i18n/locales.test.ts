import { resources } from '@/i18n';

// keysOf lists every leaf key of a translation tree as a dotted path.
const keysOf = (tree: object, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keysOf(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );

describe('locales', () => {
  const english = keysOf(resources.en.translation).sort();

  it.each([
    { name: 'Japanese', language: 'ja' as const },
    { name: 'French', language: 'fr' as const },
  ])('$name has exactly the English keys', ({ language }) => {
    expect(keysOf(resources[language].translation).sort()).toEqual(english);
  });
});
