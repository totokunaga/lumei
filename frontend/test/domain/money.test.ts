import {
  amountToText,
  formatAmountText,
  CURRENCIES,
  currencySymbol,
  formatMoney,
  parseAmount,
  readAmountText,
  type CurrencyCode,
} from '@/domain/money';

describe('CURRENCIES', () => {
  it.each(Object.entries(CURRENCIES))('gives %s the decimals Intl uses (%d)', (code, digits) => {
    const options = new Intl.NumberFormat('en', { style: 'currency', currency: code });

    expect(options.resolvedOptions().maximumFractionDigits).toBe(digits);
  });
});

describe('parseAmount (BR-EXP-08)', () => {
  it.each<{ name: string; text: string; currency: CurrencyCode; expected: number | null }>([
    { name: 'whole yen', text: '4865', currency: 'JPY', expected: 4_865 },
    { name: 'dollars and cents', text: '12.34', currency: 'USD', expected: 1_234 },
    { name: 'a comma as the decimal separator', text: '12,5', currency: 'EUR', expected: 1_250 },
    { name: 'surrounding spaces', text: ' 7 ', currency: 'USD', expected: 700 },
    { name: 'decimals for yen', text: '10.5', currency: 'JPY', expected: null },
    { name: 'too many decimals', text: '1.234', currency: 'USD', expected: null },
    { name: 'a grouping separator', text: '1,000', currency: 'JPY', expected: null },
    { name: 'a negative amount', text: '-5', currency: 'USD', expected: null },
    { name: 'zero for an expense', text: '0.00', currency: 'USD', expected: null },
    { name: 'empty text', text: '', currency: 'USD', expected: null },
    { name: 'letters', text: '12a', currency: 'USD', expected: null },
    { name: 'an unsafe integer', text: '9007199254740993', currency: 'JPY', expected: null },
  ])('parses $name', ({ text, currency, expected }) => {
    expect(parseAmount(text, currency)).toBe(expected);
  });

  it('accepts 0 with allowZero (BR-INC-04)', () => {
    expect(parseAmount('0', 'JPY', { allowZero: true })).toBe(0);
  });
});

describe('formatMoney (BR-SET-02)', () => {
  // French uses invisible spaces: U+202F between digit groups and U+00A0 before the symbol.
  it.each<{ locale: string; amount: number; currency: CurrencyCode; expected: string }>([
    { locale: 'en', amount: 4_865, currency: 'JPY', expected: '¥4,865' },
    { locale: 'ja', amount: 4_865, currency: 'JPY', expected: '￥4,865' },
    { locale: 'fr', amount: 4_865, currency: 'JPY', expected: '4 865 ¥' },
    { locale: 'en', amount: 123_456, currency: 'USD', expected: '$1,234.56' },
    { locale: 'en', amount: 500, currency: 'USD', expected: '$5.00' },
    { locale: 'fr', amount: 123_450, currency: 'EUR', expected: '1 234,50 €' },
    { locale: 'ja', amount: 7, currency: 'GBP', expected: '£0.07' },
  ])('formats $amount $currency in $locale', ({ locale, amount, currency, expected }) => {
    expect(formatMoney(amount, currency, locale)).toBe(expected);
  });
});

describe('amountToText', () => {
  it.each<{ name: string; amount: number; currency: CurrencyCode; expected: string }>([
    { name: 'yen without decimals', amount: 640_808, currency: 'JPY', expected: '640808' },
    { name: 'dollars with two decimals', amount: 123_450, currency: 'USD', expected: '1234.50' },
    { name: 'zero', amount: 0, currency: 'EUR', expected: '0.00' },
  ])('writes $name so parseAmount reads it back', ({ amount, currency, expected }) => {
    expect(amountToText(amount, currency)).toBe(expected);
    expect(parseAmount(expected, currency, { allowZero: true })).toBe(amount);
  });
});

describe('currencySymbol', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each<{ locale: string; currency: CurrencyCode; expected: string }>([
    { locale: 'en', currency: 'JPY', expected: '¥' },
    { locale: 'ja', currency: 'JPY', expected: '￥' },
    { locale: 'fr', currency: 'EUR', expected: '€' },
    { locale: 'en', currency: 'AED', expected: 'AED' },
    { locale: 'fr', currency: 'CHF', expected: 'CHF' },
  ])('gives $expected for $currency in $locale', ({ locale, currency, expected }) => {
    // Hermes, the app's engine, has no formatToParts, so it mustn't be needed.
    jest.spyOn(Intl.NumberFormat.prototype, 'formatToParts').mockImplementation(() => {
      throw new TypeError('undefined is not a function');
    });

    expect(currencySymbol(currency, locale)).toBe(expected);
  });
});

describe('formatAmountText', () => {
  it.each<{ name: string; text: string; locale: string; expected: string }>([
    { name: 'groups thousands in English', text: '1234567', locale: 'en', expected: '1,234,567' },
    { name: 'groups thousands in Japanese', text: '640808', locale: 'ja', expected: '640,808' },
    {
      name: 'groups with spaces and a decimal comma in French',
      text: '1234.5',
      locale: 'fr',
      expected: '1\u202f234,5',
    },
    { name: 'keeps a decimal point being typed', text: '1234.', locale: 'en', expected: '1,234.' },
    { name: 'writes 0 before a leading decimal point', text: '.5', locale: 'en', expected: '0.5' },
    { name: 'leaves short amounts alone', text: '999', locale: 'en', expected: '999' },
    {
      name: 'groups amounts too large for a number exactly',
      text: '12345678901234567890',
      locale: 'en',
      expected: '12,345,678,901,234,567,890',
    },
    { name: 'leaves an empty field empty', text: '', locale: 'en', expected: '' },
    { name: 'leaves other text as it is', text: '12a', locale: 'en', expected: '12a' },
  ])('$name', ({ text, locale, expected }) => {
    expect(formatAmountText(text, locale)).toBe(expected);
  });
});

describe('readAmountText', () => {
  it.each<{ name: string; input: string; currency: CurrencyCode; locale: string; expected: string }>([
    { name: 'drops English grouping', input: '1,234', currency: 'USD', locale: 'en', expected: '1234' },
    { name: 'keeps the decimal point', input: '1,234.5', currency: 'USD', locale: 'en', expected: '1234.5' },
    {
      name: 'reads a comma typed as the decimal separator in English',
      input: '1,234,5',
      currency: 'USD',
      locale: 'en',
      expected: '1234.5',
    },
    {
      name: 'keeps too many decimals for parseAmount to reject',
      input: '12.345',
      currency: 'USD',
      locale: 'en',
      expected: '12.345',
    },
    {
      name: 'drops French grouping and reads its decimal comma',
      input: '1\u202f234,50',
      currency: 'EUR',
      locale: 'fr',
      expected: '1234.50',
    },
    {
      name: 'reads a point typed as the decimal separator in French',
      input: '1\u202f234.5',
      currency: 'EUR',
      locale: 'fr',
      expected: '1234.5',
    },
    { name: 'keeps only digits for yen', input: '640,808.', currency: 'JPY', locale: 'ja', expected: '640808' },
    { name: 'leaves an empty field empty', input: '', currency: 'USD', locale: 'en', expected: '' },
  ])('$name', ({ input, currency, locale, expected }) => {
    expect(readAmountText(input, currency, locale)).toBe(expected);
  });

  it.each<{ text: string; currency: CurrencyCode; locale: string }>([
    { text: '1234.56', currency: 'USD', locale: 'en' },
    { text: '1234.56', currency: 'EUR', locale: 'fr' },
    { text: '640808', currency: 'JPY', locale: 'ja' },
  ])('reads back what formatAmountText shows: $text in $locale', ({ text, currency, locale }) => {
    expect(readAmountText(formatAmountText(text, locale), currency, locale)).toBe(text);
  });
});
