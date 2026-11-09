// Deleting the account (BR-ACC-05): the API revokes the app's access to
// every Apple and Google sign-in linked to it, then deletes all of its data.
// The device then forgets the session and its own copy of the data.
import { deleteMe } from '@/api/generated';
import { useLocalData } from '@/db/store';

import { useAuth } from './store';

/**
 * How a deletion ended: `deleted`, or why it didn't happen.
 * `unavailable`: Apple or Google can't revoke now, so the API deleted nothing.
 * `network`: the API can't be reached; deleting needs a connection.
 */
export type DeleteAccountResult = 'deleted' | 'unavailable' | 'network' | 'unknown';

/**
 * Deletes the signed-in account on the server, then signs out and deletes
 * the account's data from the device, unsynced changes included: they belong
 * to the deleted account (BR-ACC-05).
 * @returns `deleted`, or why nothing was deleted.
 */
export const deleteAccount = async (): Promise<DeleteAccountResult> => {
  const userId = useAuth.getState().session?.user.id;
  let res;
  try {
    res = await deleteMe();
  } catch {
    return 'network';
  }
  if (res.status === 503) {
    return 'unavailable';
  }
  if (res.status !== 204) {
    return 'unknown';
  }
  await useAuth.getState().forgetDeleted();
  if (userId) {
    useLocalData.getState().forget(userId);
  }
  return 'deleted';
};
