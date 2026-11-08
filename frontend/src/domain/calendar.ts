// The month calendar the period start day is picked from (BR-PER-01).
import { dateParts, daysInMonth, type IsoDate, makeDate, toUtcDate } from './date';
import type { StartDay } from './period';

/** The first day of the week: 0 for Sunday, 1 for Monday. */
export type WeekStart = 0 | 1;

/** The current month laid out as a calendar, to pick the start day from. */
export interface StartDayCalendar {
  /** Weeks of 7 cells, each a day of the month, or null for a blank before the 1st or after the last day. */
  weeks: (StartDay | null)[][];
  /** The days of the current month, e.g. 30 for November. Days after it follow it, as start days 29–31 still exist. */
  monthDays: number;
  /** Today's day of the month, e.g. 8. */
  today: StartDay;
}

/**
 * Picks the first day of the week for the app language: Monday in French, as
 * French calendars start the week; Sunday in English and Japanese.
 * @returns 1 for `'fr'`, 0 otherwise.
 */
export const weekStartFor = (language: string): WeekStart => (language === 'fr' ? 1 : 0);

/**
 * Lays out the month containing `today` as a calendar, the 1st under its
 * weekday, so the start day is picked from dates the user recognizes
 * (BR-PER-01). Every start day 1–31 has a cell: in a month shorter than 31
 * days, the days after its last follow it, e.g. 31 after November 30.
 * @returns e.g. for Nov 8, 2026, weeks starting on Sunday: the 1st on a
 *   Sunday, so the first week is 1–7, and the last is 29, 30, 31 and four blanks.
 */
export const startDayCalendar = (today: IsoDate, weekStart: WeekStart): StartDayCalendar => {
  const { year, month, day } = dateParts(today);
  const firstWeekday = toUtcDate(makeDate(year, month, 1)).getUTCDay();
  const blanks = (firstWeekday - weekStart + 7) % 7;
  const cells: (StartDay | null)[] = [
    ...Array<null>(blanks).fill(null),
    ...Array.from({ length: 31 }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  return { weeks, monthDays: daysInMonth(year, month), today: day };
};

/**
 * Names the days of the week in the app language, in calendar order.
 * @returns e.g. `['S', 'M', 'T', 'W', 'T', 'F', 'S']` in English from Sunday,
 *   and `['L', 'M', 'M', 'J', 'V', 'S', 'D']` in French from Monday.
 */
export const weekdayNames = (
  language: string,
  weekStart: WeekStart,
  width: 'narrow' | 'long' = 'narrow',
): string[] => {
  const format = new Intl.DateTimeFormat(language, { weekday: width, timeZone: 'UTC' });
  // Jan 4, 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(1970, 0, 4 + ((i + weekStart) % 7)))),
  );
};
