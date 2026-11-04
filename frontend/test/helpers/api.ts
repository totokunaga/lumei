// Fakes the Lumei API at globalThis.fetch, so tests also cover apiFetch and
// the generated client.

/**
 * Builds a response with a JSON body.
 * @returns A function returning the response, for a `mockApi` route.
 */
export const json = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/** Responds 204 with no body. */
export const noContent = () => Promise.resolve(new Response(null, { status: 204 }));

/** Fails like fetch does without a network. */
export const offline = () => Promise.reject(new TypeError('Network request failed'));

/** Answers one request. */
type Responder = () => Promise<Response>;

/**
 * Answers fetch by `METHOD /path`, e.g. `'GET /me'`, and fails the test on
 * any other request. A route given a list answers its calls in order, and
 * repeats the last answer after that.
 * @returns The fetch spy, to inspect the requests sent.
 */
export const mockApi = (routes: Partial<Record<string, Responder | Responder[]>>) => {
  const calls = new Map<string, number>();
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const route = `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`;
    const responders = routes[route];
    if (!responders) {
      throw new Error(`unexpected request: ${route}`);
    }
    const list = Array.isArray(responders) ? responders : [responders];
    const call = calls.get(route) ?? 0;
    calls.set(route, call + 1);
    return list[Math.min(call, list.length - 1)]();
  });
};

/**
 * Lists the requests sent through a `mockApi` spy.
 * @returns `METHOD /path` of each request, in order.
 */
export const requestsSent = (fetch: ReturnType<typeof mockApi>): string[] =>
  fetch.mock.calls.map(
    ([input, init]) => `${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`,
  );

/**
 * Reads the JSON body of the `index`th request sent through a `mockApi` spy.
 * @returns The parsed body.
 */
export const requestBody = (fetch: ReturnType<typeof mockApi>, index = 0): unknown =>
  JSON.parse(String(fetch.mock.calls[index][1]?.body));

/**
 * Reads a header of the `index`th request sent through a `mockApi` spy.
 * @returns The header's value, or null if the request didn't send it.
 */
export const requestHeader = (
  fetch: ReturnType<typeof mockApi>,
  name: string,
  index = 0,
): string | null => new Headers(fetch.mock.calls[index][1]?.headers).get(name);

/** A user as the API returns it. */
export const testUser = { id: '0199a6c5-3f4e-7c2a-9b1d-5e8f2a4c6d10', email: 'user@example.com' };

/**
 * Builds the API's tokens for `testUser`, as `POST /auth/sign-in` and
 * `POST /auth/refresh` return them, with an access token valid for 15 minutes.
 * @returns The response body.
 */
export const tokensBody = (accessToken = 'new-access', refreshToken = 'new-refresh') => ({
  access_token: accessToken,
  access_token_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  refresh_token: refreshToken,
  user: testUser,
});

/** A `POST /auth/sign-in` 201 response for `testUser`. */
export const signedIn = () => json(201, tokensBody());

/**
 * Builds a session as stored on the device, whose access token expires in
 * `expiresInMs` (15 minutes unless given).
 * @returns The stored session.
 */
export const storedSessionFor = (expiresInMs = 15 * 60_000) => ({
  accessToken: 'stored-access',
  accessTokenExpiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  refreshToken: 'stored-refresh',
  user: testUser,
});
