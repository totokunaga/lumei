// Saving periods: their dates (BR-PER-01, BR-PER-02) and labels (BR-PER-06).
import type { TFunction } from 'i18next';

import {
  addDays,
  dateParts,
  daysBetween,
  daysInMonth,
  makeDate,
  toUtcDate,
  type IsoDate,
} from '@/domain/date';

/** A saving period, inclusive at both ends. */
export interface Period {
  start: IsoDate;
  end: IsoDate;
}

/** The day of the month a period starts, 1–31 (BR-PER-01). */
export type StartDay = number;

/**
 * Finds the date a period starts in a given month. A start day the month
 * lacks falls on the month's last day, e.g. 31 in February (BR-PER-02).
 * @returns The start date in `month` (1–12) of `year`.
 */
const startIn = (year: number, month: number, startDay: StartDay): IsoDate =>
  makeDate(year, month, Math.min(startDay, daysInMonth(year, month)));

/**
 * Moves a month forward or back, rolling over the year.
 * @returns The year and month (1–12) `by` months after `month` of `year`, or
 *   before it if `by` is negative.
 */
const shiftMonth = (year: number, month: number, by: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/**
 * Works out which period a date falls in. A period starts on the start day of
 * a month, or that month's last day if it lacks the start day (BR-PER-02),
 * and ends the day before the next period starts (BR-PER-01).
 * @returns The start and end dates of the period containing `date`.
 * @throws RangeError if `startDay` isn't a whole number from 1 to 31, or `date` isn't valid.
 */
export const periodContaining = (date: IsoDate, startDay: StartDay): Period => {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31) {
    throw new RangeError(`period start day out of range: ${startDay}`);
  }
  const { year, month } = dateParts(date);
  let first = { year, month };
  if (date < startIn(year, month, startDay)) {
    first = shiftMonth(year, month, -1);
  }
  const next = shiftMonth(first.year, first.month, 1);
  return {
    start: startIn(first.year, first.month, startDay),
    end: addDays(startIn(next.year, next.month, startDay), -1),
  };
};

/**
 * Checks whether a date falls in a period.
 * @returns True if `date` is on or between the period's start and end dates.
 */
export const inPeriod = (period: Period, date: IsoDate): boolean =>
  period.start <= date && date <= period.end;

/**
 * Counts the days of a period (BR-CALC-01).
 * @returns The number of days from start to end, both included: 31 for Oct 25 – Nov 24.
 */
export const periodDays = (period: Period): number => daysBetween(period.start, period.end) + 1;

/**
 * Finds the month a period is named after (BR-PER-06): the one with the most
 * of its days, or the later one on a tie.
 * @returns The month's first day, e.g. `'2026-11-01'` for Oct 25 – Nov 24.
 */
export const periodMonth = (period: Period): IsoDate => {
  const days = new Map<IsoDate, number>();
  for (let date = period.start; date <= period.end; date = addDays(date, 1)) {
    const first = `${date.slice(0, 7)}-01`;
    days.set(first, (days.get(first) ?? 0) + 1);
  }
  let best = period.start;
  let most = 0;
  // Months come in order, so `>=` lets a later month win a tie.
  for (const [first, count] of days) {
    if (count >= most) {
      best = first;
      most = count;
    }
  }
  return best;
};

/**
 * Names a period by its month and year (BR-PER-06), as the home screen's
 * title shows it.
 * @param locale Formats the month, e.g. `'en'`.
 * @returns E.g. "November 2026" in English, "2026年11月" in Japanese, and
 *   "novembre 2026" in French.
 */
export const formatPeriodName = (period: Period, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    toUtcDate(periodMonth(period)),
  );

/**
 * Builds the label a period is shown under where its dates help (BR-PER-06):
 * its name and its date range, calendar months included.
 * @param t Translates the label pattern into the app language.
 * @param locale Formats the month and dates, e.g. `'en'`.
 * @returns E.g. "November 2026 (Nov 1 – Nov 30)" for start day 1, and
 *   "November 2026 (Oct 25 – Nov 24)" for start day 25.
 */
export const formatPeriodLabel = (period: Period, t: TFunction, locale: string): string =>
  t('period.labelWithRange', {
    month: formatPeriodName(period, locale),
    ...rangeParts(period, locale),
  });

/**
 * Formats a period's first and last days as a short month and day each.
 * @returns e.g. `{ start: 'Oct 25', end: 'Nov 24' }` in English.
 */
const rangeParts = (period: Period, locale: string): { start: string; end: string } => ({
  start: formatShortDate(period.start, locale),
  end: formatShortDate(period.end, locale),
});

/**
 * Formats a date as a short month and day, as period ranges show them.
 * @returns e.g. "Nov 25" in English, "11月25日" in Japanese, "25 nov." in French.
 */
export const formatShortDate = (date: IsoDate, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    toUtcDate(date),
  );

/**
 * Formats a period as its first and last days, as the home screen's title
 * shows it.
 * @param t Translates the range pattern into the app language.
 * @param locale Formats the dates, e.g. `'en'`.
 * @returns E.g. "Oct 25 – Nov 24" in English, "10月25日～11月24日" in
 *   Japanese, and "25 oct. – 24 nov." in French.
 */
export const formatPeriodRange = (period: Period, t: TFunction, locale: string): string =>
  t('period.range', rangeParts(period, locale));
