// Calendar dates without a time or a time zone. Every date in the business
// rules is a calendar date in the user's time zone (see Calculations in
// docs/requirements/business-requirements.md), so the domain never uses Date
// for them.

/** A calendar date as `YYYY-MM-DD`, e.g. `2026-10-29`. Strings compare in date order. */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Counts the days of a month, taking leap years into account.
 * @returns The number of days in `month` (1–12) of `year`: 28 to 31.
 */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Builds a date from its parts, checking that the date exists.
 * @returns The date as `YYYY-MM-DD`, e.g. `makeDate(2026, 3, 5)` is `2026-03-05`.
 * @throws RangeError if `month` isn't 1–12 or `day` doesn't exist in that month.
 */
export const makeDate = (year: number, month: number, day: number): IsoDate => {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month out of range: ${month}`);
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`day out of range: ${year}-${month}-${day}`);
  }
  return [String(year).padStart(4, '0'), pad(month), pad(day)].join('-');
};

/**
 * Splits a date into its parts, checking its format and that it exists.
 * @returns The year, month (1–12), and day of `date`.
 * @throws RangeError if `date` isn't `YYYY-MM-DD` or doesn't exist (e.g. `2026-02-30`).
 */
export const dateParts = (date: IsoDate): { year: number; month: number; day: number } => {
  const match = ISO_DATE.exec(date);
  if (!match) {
    throw new RangeError(`not a YYYY-MM-DD date: ${date}`);
  }
  const [year, month, day] = match.slice(1).map(Number);
  makeDate(year, month, day); // Rejects dates that don't exist, e.g. 2026-02-30.
  return { year, month, day };
};

/**
 * Converts a date to a day count, so dates can be added and subtracted as integers.
 * @returns The whole days from 1970-01-01 to `date` (negative before 1970).
 * @throws RangeError if `date` isn't a valid date.
 */
export const dayNumber = (date: IsoDate): number => {
  const { year, month, day } = dateParts(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
};

/**
 * Converts a day count from `dayNumber` back to a date.
 * @returns The date `days` days after 1970-01-01.
 */
export const fromDayNumber = (days: number): IsoDate => {
  const date = new Date(days * MS_PER_DAY);
  return makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

/**
 * Moves a date forward or back across months and years.
 * @returns The date `days` days after `date`, or before it if `days` is negative.
 * @throws RangeError if `date` isn't a valid date.
 */
export const addDays = (date: IsoDate, days: number): IsoDate =>
  fromDayNumber(dayNumber(date) + days);

/**
 * Counts the days between two dates.
 * @returns The whole days from `from` to `to`: 0 for the same date, negative if `to` is earlier.
 * @throws RangeError if either date isn't valid.
 */
export const daysBetween = (from: IsoDate, to: IsoDate): number => dayNumber(to) - dayNumber(from);

/**
 * Reads today's date in the device's time zone, so the day rolls over at
 * local midnight (BR-DSH-05).
 * @param now The current moment; tests pass a fixed one.
 * @returns The local calendar date of `now`.
 */
export const localToday = (now: Date = new Date()): IsoDate =>
  makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());

/**
 * Converts a date to a `Date` for `Intl` formatting. Format it with
 * `timeZone: 'UTC'`, or the device's time zone can shift it to another day.
 * @returns A `Date` at midnight UTC of `date`.
 * @throws RangeError if `date` isn't a valid date.
 */
export const toUtcDate = (date: IsoDate): Date => new Date(dayNumber(date) * MS_PER_DAY);

/**
 * Pads a month or day number to two digits.
 * @returns `n` as a string with a leading zero if it has one digit, e.g. `'03'`.
 */
const pad = (n: number): string => String(n).padStart(2, '0');
