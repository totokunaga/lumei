// Tells screens when the account's records change, so every number updates as
// soon as an expense, income, fixed expense, or target is saved, online or
// offline (BR-DSH-04, BR-NFR-04). Every write in `records.ts` announces
// itself here, and so will the sync engine's (phase 5), since it writes
// through the same functions.
import { useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

/** Announces that records changed, so screens showing them read them again. */
export const notifyChange = (): void => {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Calls `listener` after every change.
 * @returns A function that stops calling it.
 */
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Gets how many changes there have been.
 * @returns A number that grows with every change.
 */
const getVersion = (): number => version;

/**
 * Returns the records' version, which changes with every write, and re-renders
 * the component when it does. Use it as a dependency of the `useMemo` that
 * reads the records, e.g. `useMemo(() => readPeriodRecords(db, today), [version, today])`.
 * @returns A number that grows with every change.
 */
export const useDataVersion = (): number => useSyncExternalStore(subscribe, getVersion);
