// Amounts in the account currency. Every amount is an integer in the
// currency's minor unit, never a floating-point value (BR-NFR-06).

/**
 * Decimals of each supported currency's minor unit (see Currencies in the
 * business requirements).
 */
export const CURRENCIES = {
  AED: 2,
  AUD: 2,
  BRL: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  INR: 2,
  JPY: 0,
  MXN: 2,
  MYR: 2,
  PHP: 2,
  SAR: 2,
  SEK: 2,
  SGD: 2,
  THB: 2,
  USD: 2,
  ZAR: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCIES;

/** An amount as a whole number of the currency's minor unit, e.g. cents for USD. */
export type Minor = number;

/**
 * Checks whether a currency code is one Lumei supports, e.g. one read from
 * the device region (BR-SET-03).
 * @returns True if `code` is in `CURRENCIES`, which also narrows its type to `CurrencyCode`.
 */
export const isCurrencyCode = (code: string): code is CurrencyCode => code in CURRENCIES;

/**
 * Converts what the user typed into minor units, checking it is a valid
 * amount (BR-EXP-08). It accepts `.` or `,` as the decimal separator, at most
 * as many decimals as the currency has, and no grouping separators, so
 * "1,000" is rejected rather than misread.
 * @param allowZero Accept 0, for income, fixed expenses, and the saving target
 *   (BR-INC-04). Expense amounts must be greater than 0.
 * @returns The amount in minor units, e.g. 1234 for "12.34" USD, or null if
 *   the text isn't a valid amount.
 */
export const parseAmount = (
  text: string,
  currency: CurrencyCode,
  { allowZero = false }: { allowZero?: boolean } = {},
): Minor | null => {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const [, whole, fraction = ''] = match;
  const digits = CURRENCIES[currency];
  if (fraction.length > digits) {
    return null;
  }
  const minor = Number(whole + fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(minor) || (minor === 0 && !allowZero)) {
    return null;
  }
  return minor;
};

/**
 * Formats an amount for display in the app language (BR-SET-02). It uses the
 * currency's narrow symbol: a user has only one currency (BR-SET-04), so "$"
 * can't be mistaken for another dollar.
 * @param amount Minor units, e.g. 123456 for $1,234.56.
 * @returns E.g. "¥4,865" in English, "￥4,865" in Japanese, and "4 865 ¥" in French.
 */
export const formatMoney = (amount: Minor, currency: CurrencyCode, locale: string): string => {
  const digits = CURRENCIES[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
};

/**
 * Writes an amount the way the user would type it, to fill an input that
 * edits it. `parseAmount` reads it back to the same amount.
 * @param amount Minor units, e.g. 123450 for $1,234.50.
 * @returns e.g. `"1234.50"` for USD, or `"640808"` for JPY.
 */
export const amountToText = (amount: Minor, currency: CurrencyCode): string =>
  (amount / 10 ** CURRENCIES[currency]).toFixed(CURRENCIES[currency]);

/**
 * Finds the currency's symbol as `formatMoney` shows it, e.g. to label an
 * amount input.
 * It formats 0 and strips the digits, separators, spaces (\s includes the
 * no-break spaces French uses), and direction marks, because Hermes
 * (the app's JavaScript engine) has no `Intl.NumberFormat.formatToParts`.
 * @returns e.g. `"¥"` for JPY in English, `"€"` for EUR, or the code when the
 *   currency has no symbol of its own, e.g. `"AED"`.
 */
export const currencySymbol = (currency: CurrencyCode, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
    .format(0)
    .replace(/[\d\s.,\u200e\u200f\u061c-]/g, '') || currency;

/**
 * Finds the grouping and decimal separators of a language's numbers, e.g.
 * `","` and `"."` in English, a narrow no-break space and `","` in French.
 * @returns The two separators.
 */
const separators = (locale: string): { group: string; decimal: string } => {
  // "1,234.5" in English: the character after the first digit groups, the one
  // before the last digit is the decimal separator.
  const sample = new Intl.NumberFormat(locale, { useGrouping: true }).format(1234.5);
  return { group: sample.charAt(1), decimal: sample.charAt(sample.length - 2) };
};

/**
 * Shows an amount as it is typed, grouped the way the app language writes
 * numbers, e.g. to display in an amount input. It only regroups: an amount
 * the currency doesn't allow, e.g. too many decimals, stays as typed, for
 * `parseAmount` to reject.
 * @param text The amount as `amountToText` and `readAmountText` write it,
 *   with `.` as the decimal separator and no grouping, e.g. `"1234.5"`.
 * @returns e.g. `"1,234.5"` in English, `"1 234,5"` in French, `""` for `""`.
 */
export const formatAmountText = (text: string, locale: string): string => {
  const match = /^(\d*)(\.(\d*))?$/.exec(text);
  if (!match) {
    return text;
  }
  const [, whole, point, fraction = ''] = match;
  const { group, decimal } = separators(locale);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return point ? `${grouped || '0'}${decimal}${fraction}` : grouped;
};

/**
 * Reads what is in an amount input back into the text `formatAmountText`
 * shows, dropping the grouping. The keyboard's decimal key follows the device
 * region, not the app language, so `.` and `,` both work as the decimal
 * separator: the app language's own decimal separator if typed, otherwise the
 * last `.` or `,` followed by no more digits than the currency has decimals.
 * Currencies without decimals keep only the digits.
 * @param input What the field shows after the user's edit, e.g. `"1,234,5"`.
 * @returns e.g. `"1234.5"` for USD, `"1234"` for `"1,234"` in English.
 */
export const readAmountText = (input: string, currency: CurrencyCode, locale: string): string => {
  const text = input.replace(/\s/g, '');
  const digits = CURRENCIES[currency];
  if (digits === 0) {
    return text.replace(/\D/g, '');
  }
  const { decimal } = separators(locale);
  let point = /[.,]/.test(decimal) ? text.indexOf(decimal) : -1;
  if (point < 0) {
    const last = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
    const after = text.length - last - 1;
    point = last >= 0 && after <= digits ? last : -1;
  }
  if (point < 0) {
    return text.replace(/\D/g, '');
  }
  return `${text.slice(0, point).replace(/\D/g, '')}.${text.slice(point + 1).replace(/\D/g, '')}`;
};
