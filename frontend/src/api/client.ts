// The fetch function every generated API call goes through (orval mutator).

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:18080';

/**
 * Sends a request to the Lumei API and parses the JSON body. An HTTP error
 * status resolves like a success; only a network failure rejects.
 * @param url The path and query, e.g. `/health`, appended to `EXPO_PUBLIC_API_URL`.
 * @returns `{ data, status, headers }`, the shape orval's generated types
 *   expect. `data` is `{}` when the response has no body (e.g. 204).
 */
export const apiFetch = async <T>(url: string, options: RequestInit): Promise<T> => {
  const res = await fetch(`${baseUrl}${url}`, options);
  const body = [204, 205, 304].includes(res.status) ? '' : await res.text();
  const data = body ? JSON.parse(body) : {};

  return { data, status: res.status, headers: res.headers } as T;
};
