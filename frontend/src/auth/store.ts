// The signed-in state of the app (BR-ACC-01 to BR-ACC-04).
import { create } from 'zustand';

import { configureAuth } from '@/api/client';
// The API's sign-in and sign-out calls are renamed so they can't be mistaken
// for this store's own signIn and signOut actions.
import {
  getMe,
  refreshSession,
  signIn as requestSignIn,
  signOut as requestSignOut,
} from '@/api/generated';
import type { SessionResponse, SignInProvider } from '@/api/generated/model';
import { clearSession, loadSession, saveSession, type StoredSession } from '@/auth/session-storage';
import { signOutOfGoogle } from '@/auth/providers';
import { queryClient } from '@/lib/query-client';

/** Why a sign-in failed, as shown to the user. The first three are the API's error codes. */
export type SignInErrorCode =
  'email_not_verified' | 'invalid_id_token' | 'unsupported_provider' | 'network' | 'unknown';

/** A failed sign-in, with the reason to show the user. */
export class SignInError extends Error {
  /**
   * Creates the error for a reason.
   * @param code The reason, which picks the message the sign-in screen shows.
   */
  constructor(readonly code: SignInErrorCode) {
    super(`sign-in failed: ${code}`);
  }
}

const apiErrorCodes: readonly SignInErrorCode[] = [
  'email_not_verified',
  'invalid_id_token',
  'unsupported_provider',
];

interface AuthState {
  /** `restoring` until the stored session has been read at launch. */
  status: 'restoring' | 'signedOut' | 'signedIn';
  session: StoredSession | null;
  /** Reads the stored session at launch, then checks it with the API. */
  restore: () => Promise<void>;
  /** Exchanges a provider's ID token for a session. */
  signIn: (provider: SignInProvider, idToken: string) => Promise<void>;
  /** Ends the session on the server and on the device. */
  signOut: () => Promise<void>;
  /** Drops the session on the device after the API rejected it. */
  expire: () => Promise<void>;
  /** Exchanges the refresh token for new tokens. */
  refresh: () => Promise<string | null>;
}

/** Refresh this long before the access token expires, so it never expires in flight. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Converts the API's tokens to the session stored on the device.
 * @returns The session for the response's tokens and user.
 */
const toStoredSession = (res: SessionResponse): StoredSession => ({
  accessToken: res.access_token,
  accessTokenExpiresAt: res.access_token_expires_at,
  refreshToken: res.refresh_token,
  user: res.user,
});

/** The refresh in flight, shared by every request that needs it. */
let refreshing: Promise<string | null> | null = null;

/**
 * Forgets everything the signed-in user loaded, so the next user on the
 * device never sees it (BR-ACC-02).
 */
const resetLocalData = async (): Promise<void> => {
  queryClient.clear();
  await clearSession();
};

/**
 * Holds whether the user is signed in, and the session. Use it in React as
 * `useAuth((s) => s.status)`, and outside React as `useAuth.getState()`.
 */
export const useAuth = create<AuthState>()((set, get) => ({
  status: 'restoring',
  session: null,

  /**
   * Signs in with the stored session at once, without waiting for the
   * network, so the app opens offline too (BR-NFR-05). It then checks the
   * session with `GET /me`, which refreshes the tokens if needed: an ended
   * session signs the user out, and a network failure keeps them signed in.
   */
  restore: async () => {
    // If the device's storage fails, start signed out rather than stay on
    // the splash screen.
    const session = await loadSession().catch(() => null);
    if (!session) {
      set({ status: 'signedOut', session: null });
      return;
    }
    set({ status: 'signedIn', session });

    try {
      const res = await getMe();
      const current = get().session;
      if (res.status === 200 && current) {
        const updated = { ...current, user: res.data };
        set({ session: updated });
        await saveSession(updated);
      }
    } catch {
      // Offline: stay signed in with the stored session.
    }
  },

  /**
   * Sends the ID token to `POST /auth/sign-in` and stores the session.
   * @throws SignInError with the API's error code, `network` if the API
   *   can't be reached, or `unknown`.
   */
  signIn: async (provider, idToken) => {
    let res;
    try {
      res = await requestSignIn({ provider, id_token: idToken });
    } catch {
      throw new SignInError('network');
    }
    if (res.status !== 201) {
      const code = apiErrorCodes.find((c) => c === res.data.code);
      throw new SignInError(code ?? 'unknown');
    }

    const session = toStoredSession(res.data);
    await saveSession(session);
    set({ status: 'signedIn', session });
  },

  /**
   * Signs out on this device (BR-ACC-04). The device forgets the session
   * even if the API can't be reached; the server's copy then expires
   * unused (BR-ACC-03).
   */
  signOut: async () => {
    if (get().session) {
      // apiFetch refreshes the access token first if it has expired.
      try {
        await requestSignOut();
      } catch {
        // Offline: sign out on the device anyway.
      }
    }
    await signOutOfGoogle();
    await resetLocalData();
    set({ status: 'signedOut', session: null });
  },

  /**
   * Signs out on the device only, after the API rejected the session (it
   * expired, or was ended elsewhere). Safe to call more than once.
   */
  expire: async () => {
    await resetLocalData();
    set({ status: 'signedOut', session: null });
  },

  /**
   * Sends the refresh token to `POST /auth/refresh` and stores the new
   * tokens (BR-ACC-03). Concurrent calls share one request, since each
   * refresh replaces the token the next one needs. A rejected refresh token
   * signs the user out; a network failure keeps the session, so the app
   * works on offline.
   * @returns The new access token, the current one when offline, or null
   *   when the session has ended.
   */
  refresh: () => {
    refreshing ??= (async () => {
      const session = get().session;
      if (!session) {
        return null;
      }
      try {
        const res = await refreshSession({ refresh_token: session.refreshToken });
        if (res.status !== 200) {
          await get().expire();
          return null;
        }
        const renewed = toStoredSession(res.data);
        await saveSession(renewed);
        set({ session: renewed });
        return renewed.accessToken;
      } catch {
        return session.accessToken;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  },
}));

configureAuth({
  /**
   * Returns the access token, refreshing it first if it expires within
   * REFRESH_MARGIN_MS.
   * @returns The token, or null when signed out.
   */
  getAccessToken: async () => {
    const session = useAuth.getState().session;
    if (!session) {
      return null;
    }
    const expiresIn = Date.parse(session.accessTokenExpiresAt) - Date.now();
    return expiresIn > REFRESH_MARGIN_MS ? session.accessToken : useAuth.getState().refresh();
  },
  renewAccessToken: () => useAuth.getState().refresh(),
});
