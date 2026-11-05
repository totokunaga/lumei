// Recording an expense (BR-EXP-01 to BR-EXP-05): when it happened and how it
// changes today's status.
import type { TFunction } from 'i18next';

import type { TodayStatus } from './calculations';
import { addDays, type IsoDate, localToday } from './date';

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
