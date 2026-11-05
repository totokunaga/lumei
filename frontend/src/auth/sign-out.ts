// Signing out of this device (BR-ACC-04): ends the session and deletes the
// account's data from the device. Synced data stays on the server.
import { database } from '@/db/client';
import { countPendingChanges } from '@/db/records';
import { useLocalData } from '@/db/store';
import { requestSync } from '@/sync/scheduler';

import { useAuth } from './store';

/**
 * Tries to sync the changes the API hasn't confirmed, then counts the ones
 * that would still be lost by signing out now (BR-ACC-04, BR-OFF-04).
 * @returns The number of unsynced changes; 0 when none would be lost.
 */
export const syncBeforeSignOut = async (): Promise<number> => {
  if (countPendingChanges(database()) > 0) {
    await requestSync();
  }
  return countPendingChanges(database());
};

/**
 * Signs out and deletes the account's database from the device (BR-ACC-04).
 * Callers warn first when `syncBeforeSignOut()` leaves changes unsynced.
 */
export const signOutOfDevice = async (): Promise<void> => {
  const userId = useAuth.getState().session?.user.id;
  await useAuth.getState().signOut();
  if (userId) {
    useLocalData.getState().forget(userId);
  }
};
