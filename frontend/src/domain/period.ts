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
 * Checks whether a period is exactly one calendar month, which decides if
 * its label needs a date range (BR-PER-06).
 * @returns True if the period runs from the 1st to the last day of the same month.
 */
export const isCalendarMonth = (period: Period): boolean => {
  const { year, month, day } = dateParts(period.start);
  return day === 1 && period.end === makeDate(year, month, daysInMonth(year, month));
};

/**
 * Builds the label a period is shown under (BR-PER-06): the month of its end
 * date, plus its date range when it isn't a calendar month.
 * @param t Translates the label pattern into the app language.
 * @param locale Formats the month and dates, e.g. `'en'`.
 * @returns E.g. "November 2026", or "November 2026 (Oct 25 – Nov 24)" for start day 25.
 */
export const formatPeriodLabel = (period: Period, t: TFunction, locale: string): string => {
  const month = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcDate(period.end));
  if (isCalendarMonth(period)) {
    return month;
  }
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return t('period.labelWithRange', {
    month,
    start: day.format(toUtcDate(period.start)),
    end: day.format(toUtcDate(period.end)),
  });
};
