// Tells screens when the account's records change, so every number updates as
// soon as an expense, income, fixed expense, or target is saved, online or
// offline (BR-DSH-04, BR-NFR-04). Every write in `records.ts` announces
// itself here, and so does the sync engine's (`src/sync/`), so changes pulled
// from other devices show too.
import { useSyncExternalStore } from 'react';

/** Who made a change: the user on this device, or the sync engine. */
export type ChangeOrigin = 'local' | 'sync';

let version = 0;
const listeners = new Set<() => void>();
const localListeners = new Set<() => void>();

/**
 * Announces that records changed, so screens showing them read them again.
 * @param origin `'local'` for the user's own change, which the sync engine
 *   then pushes; `'sync'` for the engine's writes, which start no new sync.
 */
export const notifyChange = (origin: ChangeOrigin = 'local'): void => {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
  if (origin === 'local') {
    for (const listener of localListeners) {
      listener();
    }
  }
};

/**
 * Calls `listener` after every change the user makes on this device, e.g. so
 * the sync engine pushes it soon (BR-OFF-03).
 * @returns A function that stops calling it.
 */
export const subscribeToLocalChanges = (listener: () => void): (() => void) => {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
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
