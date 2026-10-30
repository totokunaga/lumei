import { CURRENCIES, formatMoney, parseAmount, type CurrencyCode } from '@/domain/money';

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
