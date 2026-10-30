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
