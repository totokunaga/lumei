// Keeps the session on the device across app restarts (BR-ACC-03), in the
// platform's secure storage (iOS Keychain, Android Keystore), never in plain
// storage, since the token signs the user in.
import * as SecureStore from 'expo-secure-store';

import type { User } from '@/api/generated/model';

/** A signed-in session as stored on the device. */
export interface StoredSession {
  /** The access JWT, sent with every request. */
  accessToken: string;
  /** When the access token expires, as an ISO 8601 date-time. */
  accessTokenExpiresAt: string;
  /** Gets new tokens from `POST /auth/refresh`. Each refresh replaces it. */
  refreshToken: string;
  /** The signed-in user, so the app can start signed in while offline. */
  user: User;
}

const KEY = 'lumei.session';

/**
 * Reads the stored session. A value that isn't a session is deleted and
 * treated as none, so a corrupt entry signs the user out rather than
 * crashing the app.
 * @returns The stored session, or null if there is none.
 */
export const loadSession = async (): Promise<StoredSession | null> => {
  const value = await SecureStore.getItemAsync(KEY);
  if (!value) {
    return null;
  }
  const session = parseSession(value);
  if (!session) {
    await clearSession();
  }
  return session;
};

/**
 * Parses a stored value, checking it has the tokens and a user.
 * @returns The session, or null if the value isn't one.
 */
const parseSession = (value: string): StoredSession | null => {
  try {
    const session = JSON.parse(value) as Partial<StoredSession> | null;
    return typeof session?.accessToken === 'string' &&
      typeof session.refreshToken === 'string' &&
      typeof session.accessTokenExpiresAt === 'string' &&
      typeof session.user?.id === 'string'
      ? (session as StoredSession)
      : null;
  } catch {
    return null;
  }
};

/**
 * Stores the session, replacing any earlier one. It is readable after the
 * first unlock, so the app can restore it when it starts in the background.
 */
export const saveSession = (session: StoredSession): Promise<void> =>
  SecureStore.setItemAsync(KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });

/** Deletes the stored session, if any. */
export const clearSession = (): Promise<void> => SecureStore.deleteItemAsync(KEY);
