// Record IDs are made on the device, so a change made offline already has its
// final ID (BR-OFF-03; see docs/architecture/offline-sync.md).
import { getRandomBytes } from 'expo-crypto';
import { v5, v7 } from 'uuid';

/** The UUIDv5 namespace of every derived Lumei ID. Never change it: IDs already stored derive from it. */
const NAMESPACE = 'b6a4c1f2-5d0e-4a8b-9c37-2f1e8d6a4b90';

/**
 * Makes a new, unique record ID: a UUIDv7, which sorts by creation time.
 * @returns e.g. `"0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d10"`.
 */
export const newId = (): string => v7({ random: getRandomBytes(16) });

/**
 * Derives the ID of a record every device must create identically, such as a
 * default category or an automatically created period, so two devices that
 * create it offline end up with one record (BR-OFF-03).
 * @param parts What identifies the record, e.g. the user ID, `'period'`, and its start date.
 * @returns A UUIDv5: always the same for the same parts.
 */
export const derivedId = (...parts: string[]): string => v5(parts.join('/'), NAMESPACE);
