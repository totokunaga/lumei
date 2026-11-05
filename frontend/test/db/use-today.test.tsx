import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { database, openUserDatabase } from '@/db/client';
import { readPeriodRecords } from '@/db/records';
import { useToday } from '@/db/use-today';

import { finishedSetup } from '../helpers/account';
import { testUser } from '../helpers/api';

describe('useToday (BR-DSH-05)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Sets up the account in November 2026, with the clock at `now`, and opens it. */
  const setUp = async (now: Date) => {
    jest.useFakeTimers({ now: new Date(2026, 10, 15, 12) });
    await finishedSetup();
    await openUserDatabase(testUser.id);
    jest.setSystemTime(now);
  };

  it('moves to the next day at local midnight', async () => {
    await setUp(new Date(2026, 10, 15, 23, 59, 30));
    const { result } = await renderHook(() => useToday());
    expect(result.current).toBe('2026-11-15');

    await act(() => jest.advanceTimersByTime(60_000));

    expect(result.current).toBe('2026-11-16');
  });

  it('creates the next period when the day moves past the end of this one (BR-PER-03)', async () => {
    await setUp(new Date(2026, 10, 30, 23, 59, 30));
    const { result } = await renderHook(() => useToday());

    await act(() => jest.advanceTimersByTime(60_000));

    expect(result.current).toBe('2026-12-01');
    expect(readPeriodRecords(database(), '2026-12-01')?.income).toEqual([300_000]);
  });

  it('catches up when the app comes back to the foreground on a later day', async () => {
    let listener: (state: AppStateStatus) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler;
      return { remove: () => {} };
    });
    await setUp(new Date(2026, 10, 15, 21));
    const { result } = await renderHook(() => useToday());

    // Suspended in the background, timers don't run; the clock moves on regardless.
    jest.setSystemTime(new Date(2026, 10, 17, 8));
    await act(() => listener('active'));

    expect(result.current).toBe('2026-11-17');
  });
});
