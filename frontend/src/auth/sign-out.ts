// Signing out of this device (BR-ACC-04): ends the session and deletes the
// account's data from the device. Synced data stays on the server.
import { database } from '@/db/client';
import { countPendingChanges } from '@/db/records';
import { useLocalData } from '@/db/store';

import { useAuth } from './store';

/**
 * Counts the changes that would be lost by signing out now, because the API
 * hasn't confirmed them (BR-OFF-04). Until the sync engine exists, that is
 * every change made on the device.
 * @returns The number of unsynced changes; 0 when none would be lost.
 */
export const unsyncedChanges = (): number => countPendingChanges(database());

/**
 * Signs out and deletes the account's database from the device (BR-ACC-04).
 * Callers warn first when `unsyncedChanges()` isn't 0. Syncing first comes
 * with the sync engine (docs/architecture/offline-sync.md).
 */
export const signOutOfDevice = async (): Promise<void> => {
  const userId = useAuth.getState().session?.user.id;
  await useAuth.getState().signOut();
  if (userId) {
    useLocalData.getState().forget(userId);
  }
};
