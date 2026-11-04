// Whether the signed-in account's database is open, and whether its setup has
// finished. The root layout reads it to choose between setup and the home
// screen (BR-ACC-06).
import { create } from 'zustand';

import { closeUserDatabase, deleteUserDatabase, openUserDatabase } from './client';
import { readSettings } from './records';

/** The state of the account's database on the device. */
interface LocalDataState {
  /** `opening` until the database is open and migrated; `failed` if that didn't work. */
  status: 'closed' | 'opening' | 'ready' | 'failed';
  /** The account whose database is open or opening. */
  userId: string | null;
  /** True once the account has finished setup on this device (BR-ACC-06). */
  setupCompleted: boolean;
  /** Opens the account's database and reads whether setup has finished. */
  open: (userId: string) => Promise<void>;
  /** Closes the database, keeping its file, e.g. when the session expires. */
  close: () => void;
  /** Records that setup has finished, which sends the user to the home screen. */
  completeSetup: () => void;
  /** Deletes the account's data from the device, as signing out does (BR-ACC-04). */
  forget: (userId: string) => void;
}

/**
 * Holds the state of the account's database.
 * @returns The Zustand store hook; call `useLocalData.getState()` outside React.
 */
export const useLocalData = create<LocalDataState>()((set, get) => ({
  status: 'closed',
  userId: null,
  setupCompleted: false,

  open: async (userId) => {
    if (get().userId === userId && get().status !== 'failed') {
      return;
    }
    set({ status: 'opening', userId, setupCompleted: false });
    try {
      const db = await openUserDatabase(userId);
      if (get().userId === userId) {
        set({ status: 'ready', setupCompleted: readSettings(db) !== null });
      }
    } catch {
      if (get().userId === userId) {
        set({ status: 'failed' });
      }
    }
  },

  close: () => {
    closeUserDatabase();
    set({ status: 'closed', userId: null, setupCompleted: false });
  },

  completeSetup: () => set({ setupCompleted: true }),

  forget: (userId) => {
    deleteUserDatabase(userId);
    set({ status: 'closed', userId: null, setupCompleted: false });
  },
}));
