// Changing the period start day (BR-PER-05): past periods and the current
// period's start keep their dates, and the user chooses where the days
// between the current period's end and the next new start go.
import { addDays, type IsoDate } from './date';
import { type Period, periodContaining, type StartDay } from './period';

/**
 * Where the days between the current period's end and the next new start go
 * (BR-PER-05):
 * - `current`: the current period ends the day before the next new start.
 * - `next`: the next period starts the day after the current one ends and
 *   ends where the new start day says, a period later.
 * - `own`: the days are a period of their own.
 */
export type GapChoice = 'current' | 'next' | 'own';

/**
 * Finds the days a new start day leaves between the current period's end and
 * the first period the new start day gives.
 * @param current The current period, whose dates stay.
 * @returns The days, both inclusive, or null if the new start day begins a
 *   period the day after the current one ends, so nothing needs choosing.
 */
export const startDayGap = (current: Period, startDay: StartDay): Period | null => {
  const after = addDays(current.end, 1);
  const containing = periodContaining(after, startDay);
  return containing.start === after ? null : { start: after, end: containing.end };
};

/** What a start-day change stores. */
export interface StartDayChange {
  /** The current period's end: changed only by the `current` choice. */
  currentEnd: IsoDate;
  /**
   * The next period's end, when it differs from what the start day says
   * (the `next` choice); null otherwise.
   */
  nextPeriodEnd: IsoDate | null;
}

/**
 * Works out what changing the start day stores (BR-PER-05).
 * @param choice Where the gap goes; ignored when there is no gap.
 * @returns The current period's end and the next period's end, if fixed.
 */
export const startDayChange = (
  current: Period,
  startDay: StartDay,
  choice: GapChoice,
): StartDayChange => {
  const gap = startDayGap(current, startDay);
  if (!gap || choice === 'own') {
    return { currentEnd: current.end, nextPeriodEnd: null };
  }
  if (choice === 'current') {
    return { currentEnd: gap.end, nextPeriodEnd: null };
  }
  return {
    currentEnd: current.end,
    nextPeriodEnd: periodContaining(addDays(gap.end, 1), startDay).end,
  };
};
