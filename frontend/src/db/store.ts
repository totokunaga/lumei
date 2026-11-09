// Whether the signed-in account's database is open, and whether its setup has
// finished. The root layout reads it to choose between setup and the home
// screen (BR-ACC-06).
import { create } from 'zustand';

import { localToday } from '@/domain/date';
import { forgetShortcutAccount } from '@/lib/expense-shortcut';
import { syncOnce } from '@/sync/engine';

import { closeUserDatabase, database, deleteUserDatabase, openUserDatabase } from './client';
import { countPendingChanges, ensureCurrentPeriod, readSettings } from './records';

/** The state of the account's database on the device. */
interface LocalDataState {
  /**
   * `opening` until the database is open and migrated, and holds the
   * account's data; `failed` if it couldn't be opened; `unreachable` if a
   * new device couldn't download the account's data (BR-ACC-06).
   */
  status: 'closed' | 'opening' | 'ready' | 'failed' | 'unreachable';
  /** The account whose database is open or opening. */
  userId: string | null;
  /** True once the account has finished setup on this device (BR-ACC-06). */
  setupCompleted: boolean;
  /**
   * Opens the account's database, creates any period that started since the
   * app was last open (BR-PER-03), and reads whether setup has finished. A
   * database without setup first downloads the account's data, so signing in
   * on a new device skips setup when another device finished it (BR-ACC-06).
   */
  open: (userId: string) => Promise<void>;
  /** Closes the database, keeping its file, e.g. when the session expires. */
  close: () => void;
  /** Records that setup has finished, which sends the user to the home screen. */
  completeSetup: () => void;
  /**
   * Deletes the account's data from the device, as signing out does
   * (BR-ACC-04), and stops the Add Expense shortcut recording into it (BR-EXP-12).
   */
  forget: (userId: string) => void;
  /**
   * Deletes the account's data from the device if every change has synced,
   * after its session ended elsewhere: the device's copy then only repeats
   * what the API holds, or held before the account was deleted (BR-ACC-05).
   * With unsynced changes it keeps the file, so signing in again uploads them
   * (BR-OFF-04).
   */
  forgetIfSynced: (userId: string) => void;
}

/**
 * The account whose session ended while its database was still opening, so
 * `open` decides whether to keep its data once the file is open.
 */
let forgetOnceOpen: string | null = null;

/**
 * Deletes the open account database if every change in it has synced
 * (BR-ACC-05), and otherwise closes it, keeping the file, so signing in again
 * uploads the changes (BR-OFF-04).
 */
const closeOrDiscard = (userId: string): void => {
  if (countPendingChanges(database()) > 0) {
    closeUserDatabase();
    return;
  }
  forgetShortcutAccount();
  deleteUserDatabase(userId);
};

/**
 * Settles a session that ended while `open` was still opening the account's
 * database, now that the file is open.
 * @returns True if it ended, so `open` stops.
 */
const endedWhileOpening = (userId: string): boolean => {
  if (forgetOnceOpen !== userId) {
    return false;
  }
  forgetOnceOpen = null;
  closeOrDiscard(userId);
  return true;
};

/**
 * Holds the state of the account's database.
 * @returns The Zustand store hook; call `useLocalData.getState()` outside React.
 */
export const useLocalData = create<LocalDataState>()((set, get) => ({
  status: 'closed',
  userId: null,
  setupCompleted: false,

  open: async (userId) => {
    const { status } = get();
    if (get().userId === userId && status !== 'failed' && status !== 'unreachable') {
      return;
    }
    set({ status: 'opening', userId, setupCompleted: false });
    try {
      const db = await openUserDatabase(userId);
      if (endedWhileOpening(userId)) {
        return;
      }
      const downloaded = readSettings(db) !== null || (await syncOnce(db)) === 'synced';
      if (endedWhileOpening(userId)) {
        return;
      }
      if (!downloaded) {
        if (get().userId === userId) {
          set({ status: 'unreachable' });
        }
        return;
      }
      if (get().userId === userId) {
        // A period that ended while the app was closed gets its successors first (BR-PER-03).
        ensureCurrentPeriod(db, localToday(), Date.now());
        set({ status: 'ready', setupCompleted: readSettings(db) !== null });
      }
    } catch {
      if (forgetOnceOpen === userId) {
        forgetOnceOpen = null;
      }
      if (get().userId === userId) {
        set({ status: 'failed' });
      }
    }
  },

  close: () => {
    // A file still opening after its session ended is left to `open`, which
    // decides whether to keep it.
    if (forgetOnceOpen === null) {
      closeUserDatabase();
    }
    set({ status: 'closed', userId: null, setupCompleted: false });
  },

  completeSetup: () => set({ setupCompleted: true }),

  forget: (userId) => {
    // The shortcut stops first, so it can't write into a file being deleted (BR-EXP-12).
    forgetShortcutAccount();
    deleteUserDatabase(userId);
    set({ status: 'closed', userId: null, setupCompleted: false });
  },

  forgetIfSynced: (userId) => {
    const { status } = get();
    if (get().userId !== userId) {
      return;
    }
    if (status === 'opening') {
      forgetOnceOpen = userId;
      return;
    }
    if (status === 'ready') {
      closeOrDiscard(userId);
      set({ status: 'closed', userId: null, setupCompleted: false });
    }
  },
}));
