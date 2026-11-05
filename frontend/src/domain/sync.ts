// The conflict rules of sync (BR-OFF-05), the same as the API's
// (`application.Wins` in backend/internal/application/sync.go), so the device
// and the API always agree on which change wins. See
// docs/architecture/offline-sync.md.

/** The sync columns the conflict rules compare. */
export interface Version {
  /** When the user made the change, in milliseconds since the epoch, by the device's clock. */
  updatedAt: number;
  /** When the user deleted the record, or null while it exists. */
  deletedAt: number | null;
}

/**
 * Checks whether an incoming change replaces the stored version of a record
 * (BR-OFF-05):
 * 1. A deletion wins over any edit, and a deleted record never changes back.
 * 2. Otherwise the change with the later `updatedAt` wins.
 * 3. On a tie, the stored version stays.
 * @param incoming The change arriving, e.g. pulled from the API.
 * @param stored The version kept so far, e.g. an unsynced local change.
 * @returns True if `incoming` wins.
 */
export const wins = (incoming: Version, stored: Version): boolean => {
  if (stored.deletedAt !== null) {
    return false;
  }
  if (incoming.deletedAt !== null) {
    return true;
  }
  return incoming.updatedAt > stored.updatedAt;
};
