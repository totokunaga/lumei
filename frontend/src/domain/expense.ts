// Recording an expense (BR-EXP-01 to BR-EXP-05): when it happened and how it
// changes today's status.
import type { TFunction } from 'i18next';

import type { TodayStatus } from './calculations';
import { addDays, type IsoDate, localToday } from './date';
import type { Minor } from './money';

/**
 * Works out an expense's date: the calendar date in the device's time zone
 * when it happened (BR-EXP-02, BR-DSH-05).
 * @param spentAt When it happened, in milliseconds since the epoch.
 * @returns e.g. `'2026-11-05'`.
 */
export const expenseDate = (spentAt: number): IsoDate => localToday(new Date(spentAt));

/**
 * Keeps a chosen moment within what an expense allows (BR-EXP-02): no later
 * than now, and no earlier than the first period's start, which no earlier
 * date belongs to.
 * @param chosen The moment the user picked, in milliseconds since the epoch.
 * @param now The current moment, in milliseconds since the epoch.
 * @param earliest The start date of the account's first period.
 * @returns `chosen`, or `now` if it is later, or midnight in the device's
 *   time zone at the start of `earliest` if it is before that day.
 */
export const clampSpentAt = (chosen: number, now: number, earliest: IsoDate): number => {
  if (chosen > now) {
    return now;
  }
  if (expenseDate(chosen) < earliest) {
    const [year, month, day] = earliest.split('-').map(Number);
    return new Date(year, month - 1, day).getTime();
  }
  return chosen;
};

/**
 * Checks whether today is over its allowance: either today's spending is more
 * than the allowance, or the whole period is overspent (BR-DSH-02). Saving an
 * expense that leaves the user over gets a gentler haptic than a plain save.
 * @returns True if remaining today is negative, or the period is overspent.
 */
export const isOverToday = (status: TodayStatus): boolean =>
  status.periodOverspend > 0 || (status.remainingToday ?? 0) < 0;

/**
 * Describes when an expense happened, for the home screen's list
 * (BR-DSH-06): "Today" or "Yesterday" with the time for the last two days,
 * and the short date with the time before that.
 * @param spentAt When it happened, in milliseconds since the epoch.
 * @param today Today's date in the device's time zone (BR-DSH-05).
 * @param t Translates "Today" and "Yesterday" into the app language.
 * @param locale Formats the date and time, e.g. `'en'`.
 * @returns E.g. "Today, 12:30 PM", "Yesterday, 9:05 AM", or "Nov 3, 6:40 PM" in English.
 */
export const formatExpenseTime = (
  spentAt: number,
  today: IsoDate,
  t: TFunction,
  locale: string,
): string => {
  const at = new Date(spentAt);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
  const date = expenseDate(spentAt);
  if (date === today) {
    return t('home.todayAt', { time });
  }
  if (date === addDays(today, -1)) {
    return t('home.yesterdayAt', { time });
  }
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(at);
  return t('home.dateAt', { date: day, time });
};

/** A day of a list of expenses, with its total (BR-DSH-06). */
export interface ExpenseDay<T> {
  date: IsoDate;
  /** Every expense of the day, at its full amount, big purchases included. */
  total: Minor;
  expenses: T[];
}

/**
 * Groups expenses by their date, keeping their order: listed newest first,
 * the days come newest first too (BR-DSH-06).
 * @returns One entry per day, with the day's expenses and their total.
 */
export const groupByDay = <T extends { date: IsoDate; amount: Minor }>(
  expenses: T[],
): ExpenseDay<T>[] => {
  const days = new Map<IsoDate, ExpenseDay<T>>();
  for (const expense of expenses) {
    const day = days.get(expense.date) ?? { date: expense.date, total: 0, expenses: [] };
    day.total += expense.amount;
    day.expenses.push(expense);
    days.set(expense.date, day);
  }
  return [...days.values()];
};

/**
 * Names a day as a list heading (BR-DSH-06): "Today", "Yesterday", or the
 * date, with the year only when it isn't this year's.
 * @param today Today's date in the device's time zone (BR-DSH-05).
 * @returns E.g. "Today", or "October 28" and "December 30, 2025" in English.
 */
export const formatDayHeading = (
  date: IsoDate,
  today: IsoDate,
  t: TFunction,
  locale: string,
): string => {
  if (date === today) {
    return t('home.today');
  }
  if (date === addDays(today, -1)) {
    return t('home.yesterday');
  }
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
  }).format(new Date(year, month - 1, day));
};

/**
 * Formats the time an expense happened, as a row under its day's heading shows it.
 * @returns E.g. "12:30 PM" in English, "12:30" in Japanese and French.
 */
export const formatExpenseClock = (spentAt: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(spentAt));

/**
 * How much of today's allowance is used, in bands that color today's card
 * (BR-DSH-01): `low` below 65%, `high` from 65%, and `critical` from 80%,
 * over 100% included.
 */
export type AllowanceUse = 'low' | 'high' | 'critical';

/** Where each band starts, as a share of the allowance. */
export const ALLOWANCE_USE_FROM = { high: 0.65, critical: 0.8 } as const;

/**
 * Works out how much of today's allowance is used (BR-DSH-01).
 * @returns The band; `critical` without an allowance, while the period is
 *   overspent (BR-DSH-02).
 */
export const allowanceUse = (spent: Minor, allowance: Minor): AllowanceUse => {
  if (allowance <= 0) {
    return 'critical';
  }
  const share = spent / allowance;
  if (share >= ALLOWANCE_USE_FROM.critical) {
    return 'critical';
  }
  return share >= ALLOWANCE_USE_FROM.high ? 'high' : 'low';
};

/**
 * How spending so far compares with the spending limit by today, in bands
 * that color the progress chart (BR-CHT-02): `low` below 90% of the limit,
 * `high` from 90% up to the limit, and `critical` over it.
 */
export type LimitUse = AllowanceUse;

/** Where the chart's `high` band starts, as a share of the limit. */
export const LIMIT_USE_HIGH_FROM = 0.9;

/**
 * Works out how close spending so far is to the spending limit (BR-CHT-02).
 * @param spent Spending so far, as the chart counts it.
 * @param limit The spending limit by the same day (BR-CALC-06).
 * @returns The band; `critical` for any spending against a limit of 0 or less.
 */
export const limitUse = (spent: number, limit: number): LimitUse => {
  if (spent > limit) {
    return 'critical';
  }
  return limit > 0 && spent >= limit * LIMIT_USE_HIGH_FROM ? 'high' : 'low';
};

/**
 * Works out the band that colors today's card and the add button
 * (BR-DSH-01): `allowanceUse` of today's spending, and `critical` whenever
 * today is over its allowance or the period is overspent (BR-DSH-02).
 * @returns The band.
 */
export const todayUse = (status: TodayStatus): AllowanceUse =>
  isOverToday(status) ? 'critical' : allowanceUse(status.spentToday, status.allowance);
