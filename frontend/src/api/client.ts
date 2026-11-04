// The fetch function every generated API call goes through (orval mutator).

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:18080';

/** How `apiFetch` gets access tokens. Set by `configureAuth`. */
interface AuthHooks {
  /**
   * Returns an access token valid for a while longer, refreshing it first
   * if it is about to expire, or null when signed out.
   */
  getAccessToken: () => Promise<string | null>;
  /**
   * Refreshes the tokens after the API rejected the access token. Returns
   * the new access token, or null if the session has ended, in which case
   * it has signed the user out.
   */
  renewAccessToken: () => Promise<string | null>;
}

let auth: AuthHooks | null = null;

/**
 * Connects `apiFetch` to the session, so requests carry an access token that
 * is kept fresh. The auth store calls it once; the client doesn't import the
 * store, which imports the client.
 */
export const configureAuth = (hooks: AuthHooks): void => {
  auth = hooks;
};

/** Paths that sign in or refresh, and so must not wait for, or start, a refresh. */
const tokenPaths = ['/auth/sign-in', '/auth/refresh'];

/**
 * Sends a request to the Lumei API and parses the JSON body. While signed in,
 * it adds `Authorization: Bearer <access token>`, refreshing the token first
 * if it is about to expire. If the API still answers 401, it refreshes once
 * and retries. An HTTP error status resolves like a success; only a network
 * failure rejects.
 * @param url The path and query, e.g. `/health`, appended to `EXPO_PUBLIC_API_URL`.
 * @returns `{ data, status, headers }`, the shape orval's generated types
 *   expect. `data` is `{}` when the response has no body (e.g. 204).
 */
export const apiFetch = async <T>(url: string, options: RequestInit): Promise<T> => {
  const authenticated = auth && !tokenPaths.some((path) => url.startsWith(path)) ? auth : null;

  let token = (await authenticated?.getAccessToken()) ?? null;
  let res = await send(url, options, token);
  if (res.status === 401 && token && authenticated) {
    token = await authenticated.renewAccessToken();
    if (token) {
      res = await send(url, options, token);
    }
  }

  const body = [204, 205, 304].includes(res.status) ? '' : await res.text();
  const data = body ? JSON.parse(body) : {};
  return { data, status: res.status, headers: res.headers } as T;
};

/**
 * Sends one request, with the access token if there is one.
 * @returns The response.
 */
const send = (url: string, options: RequestInit, token: string | null): Promise<Response> => {
  const headers = new Headers(options.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(`${baseUrl}${url}`, { ...options, headers });
};
