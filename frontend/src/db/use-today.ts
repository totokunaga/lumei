import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { type IsoDate, localToday } from '@/domain/date';

import { database } from './client';
import { ensureCurrentPeriod } from './records';

/**
 * Works out how long until the next local midnight.
 * @returns Milliseconds from `now` to the start of tomorrow in the device's time zone.
 */
const untilMidnight = (now: Date): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();

/**
 * Returns today's date in the device's time zone, which changes at local
 * midnight and when the app comes back to the foreground on a later day
 * (BR-DSH-05). When the day moves past the end of the period, it creates the
 * next one first (BR-PER-03), so today always has a period.
 * @returns e.g. `'2026-11-05'`.
 */
export const useToday = (): IsoDate => {
  const [today, setToday] = useState(localToday);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    /** Moves to the current date if it changed, then waits for the next midnight. */
    const check = () => {
      clearTimeout(timer);
      const now = new Date();
      const current = localToday(now);
      if (current !== today) {
        ensureCurrentPeriod(database(), current, now.getTime());
        setToday(current);
        return;
      }
      // A little past midnight, so the clock has surely moved to the new day.
      timer = setTimeout(check, untilMidnight(now) + 100);
    };

    check();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        check();
      }
    });
    return () => {
      clearTimeout(timer);
      foreground.remove();
    };
  }, [today]);

  return today;
};
