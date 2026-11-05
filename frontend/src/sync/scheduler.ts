// When the sync engine runs (BR-OFF-03): when the app opens or returns to the
// foreground, a few seconds after the user's change, when the network comes
// back, and every minute while the app is open. Only one cycle runs at a
// time; a request during one runs another right after it.
import * as Network from 'expo-network';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { subscribeToLocalChanges } from '@/db/changes';
import { database } from '@/db/client';

import { type SyncResult, syncOnce } from './engine';

/** How long after the user's change it syncs, so a burst of changes goes in one push. */
export const CHANGE_DELAY_MS = 3_000;

/** How often it syncs while the app is open. */
export const INTERVAL_MS = 60_000;

/** The sync engine's state, for screens that show it (BR-OFF-04). */
interface SyncStatus {
  /** True while a cycle runs. */
  syncing: boolean;
  /** How the last cycle ended, or null before the first. */
  last: SyncResult | null;
}

/**
 * Holds the sync engine's state.
 * @returns The Zustand store hook.
 */
export const useSyncStatus = create<SyncStatus>()(() => ({ syncing: false, last: null }));

let running: Promise<SyncResult> | null = null;
let again = false;

/**
 * Runs a sync cycle now, or right after the one running.
 * @returns How the cycle ended: the one requested, or the running one's
 *   follow-up. `failed` when no account database is open.
 */
export const requestSync = (): Promise<SyncResult> => {
  if (running) {
    again = true;
    return running;
  }
  const cycles = async (): Promise<SyncResult> => {
    useSyncStatus.setState({ syncing: true });
    let result: SyncResult;
    do {
      again = false;
      try {
        result = await syncOnce(database());
      } catch {
        // Signed out: no database to sync.
        result = 'failed';
      }
    } while (again && result === 'synced');
    useSyncStatus.setState({ syncing: false, last: result });
    return result;
  };
  // Cleared only once settled: without a database, the cycles end before
  // `running` is even set.
  const current = cycles().finally(() => {
    running = null;
  });
  running = current;
  return current;
};

/**
 * Syncs while mounted, which the root layout does once the account's data is
 * open: now, on every return to the foreground, `CHANGE_DELAY_MS` after the
 * user's changes, when the network comes back, and every `INTERVAL_MS`.
 */
export const useSync = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => void requestSync();

    sync();
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        sync();
      }
    }, INTERVAL_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sync();
      }
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        sync();
      }
    });
    const unsubscribe = subscribeToLocalChanges(() => {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(sync, CHANGE_DELAY_MS);
    });

    return () => {
      clearTimeout(changeTimer);
      clearInterval(interval);
      appState.remove();
      network.remove();
      unsubscribe();
    };
  }, [enabled]);
};
