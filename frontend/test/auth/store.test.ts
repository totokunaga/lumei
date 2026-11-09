import { waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { getHealth } from '@/api/generated';
import { SignInError, useAuth } from '@/auth/store';
import { useLocalData } from '@/db/store';
import { queryClient } from '@/lib/query-client';

import { finishedSetup, syncedRecords } from '../helpers/account';

import {
  json,
  mockApi,
  noContent,
  offline,
  requestBody,
  requestHeader,
  requestsSent,
  signedIn,
  storedSessionFor,
  testUser as user,
  tokensBody,
} from '../helpers/api';
import { hasDatabase } from '../helpers/database';

const SESSION_KEY = 'lumei.session';
const unauthenticated = json(401, { code: 'unauthenticated', message: '' });

/** Stores a session on the device, as an earlier sign-in would have. */
const storeSession = (value: unknown) =>
  SecureStore.setItemAsync(SESSION_KEY, typeof value === 'string' ? value : JSON.stringify(value));

/** Reads the session stored on the device. */
const storedSession = async () => {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  return value ? JSON.parse(value) : null;
};

/** Signs in with a stored session, as if restored at launch. */
const signedInWith = async (session: ReturnType<typeof storedSessionFor>) => {
  await storeSession(session);
  useAuth.setState({ status: 'signedIn', session });
};

beforeEach(() => useAuth.setState({ status: 'restoring', session: null }));
afterEach(() => jest.restoreAllMocks());

describe('restore (BR-ACC-03)', () => {
  const fresh = storedSessionFor();

  it.each([
    {
      name: 'signed out with no stored session',
      stored: null,
      routes: {},
      expected: { status: 'signedOut', session: null, stored: null },
    },
    {
      name: 'signed out with a stored value that is not a session',
      stored: '{not json',
      routes: {},
      expected: { status: 'signedOut', session: null, stored: null },
    },
    {
      name: 'signed out when the device storage fails',
      stored: 'storage fails',
      routes: {},
      expected: { status: 'signedOut', session: null, stored: null },
    },
    {
      name: 'signed out with a stored null',
      stored: 'null',
      routes: {},
      expected: { status: 'signedOut', session: null, stored: null },
    },
    {
      name: 'signed in with the user the API reports',
      stored: fresh,
      routes: { 'GET /me': json(200, { ...user, email: 'renamed@example.com' }) },
      expected: {
        status: 'signedIn',
        session: { ...fresh, user: { ...user, email: 'renamed@example.com' } },
        stored: { ...fresh, user: { ...user, email: 'renamed@example.com' } },
      },
    },
    {
      name: 'signed out when the session has ended on the server',
      stored: fresh,
      routes: { 'GET /me': unauthenticated, 'POST /auth/refresh': unauthenticated },
      expected: { status: 'signedOut', session: null, stored: null },
    },
    {
      name: 'signed in with the stored session while offline (BR-NFR-05)',
      stored: fresh,
      routes: { 'GET /me': offline },
      expected: { status: 'signedIn', session: fresh, stored: fresh },
    },
  ])('is $name', async ({ stored, routes, expected }) => {
    if (stored === 'storage fails') {
      jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('unavailable'));
    } else if (stored) {
      await storeSession(stored);
    }
    mockApi(routes);

    await useAuth.getState().restore();

    const { status, session } = useAuth.getState();
    expect({ status, session, stored: await storedSession() }).toEqual(expected);
  });
});

describe('access tokens', () => {
  it('sends the access token with requests', async () => {
    await signedInWith(storedSessionFor());
    const fetch = mockApi({ 'GET /health': json(200, { status: 'ok' }) });

    await getHealth();

    expect(requestHeader(fetch, 'Authorization')).toBe('Bearer stored-access');
  });

  it('refreshes an access token about to expire before sending the request', async () => {
    await signedInWith(storedSessionFor(30_000));
    const fetch = mockApi({
      'POST /auth/refresh': json(200, tokensBody()),
      'GET /health': json(200, { status: 'ok' }),
    });

    await getHealth();

    expect(requestsSent(fetch)).toEqual(['POST /auth/refresh', 'GET /health']);
    expect(requestBody(fetch)).toEqual({ refresh_token: 'stored-refresh' });
    expect(requestHeader(fetch, 'Authorization', 1)).toBe('Bearer new-access');
    expect(await storedSession()).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });

  it('refreshes and retries once when the API rejects the access token', async () => {
    await signedInWith(storedSessionFor());
    const fetch = mockApi({
      'GET /health': [unauthenticated, json(200, { status: 'ok' })],
      'POST /auth/refresh': json(200, tokensBody()),
    });

    const res = await getHealth();

    expect(res.status).toBe(200);
    expect(requestsSent(fetch)).toEqual(['GET /health', 'POST /auth/refresh', 'GET /health']);
    expect(requestHeader(fetch, 'Authorization', 2)).toBe('Bearer new-access');
  });

  it('shares one refresh between concurrent requests, since each refresh replaces the token', async () => {
    await signedInWith(storedSessionFor(30_000));
    const fetch = mockApi({
      'POST /auth/refresh': json(200, tokensBody()),
      'GET /health': json(200, { status: 'ok' }),
    });

    await Promise.all([getHealth(), getHealth(), getHealth()]);

    expect(requestsSent(fetch).filter((r) => r === 'POST /auth/refresh')).toHaveLength(1);
  });

  it.each([
    {
      name: 'signs out when the refresh token is rejected',
      refresh: unauthenticated,
      expected: { status: 'signedOut', keepsSession: false },
    },
    {
      name: 'stays signed in when the refresh fails offline',
      refresh: offline,
      expected: { status: 'signedIn', keepsSession: true },
    },
  ])('$name', async ({ refresh, expected }) => {
    const session = storedSessionFor(30_000);
    await signedInWith(session);
    mockApi({ 'POST /auth/refresh': refresh, 'GET /health': json(200, { status: 'ok' }) });

    await getHealth();

    await waitFor(() => expect(useAuth.getState().status).toBe(expected.status));
    expect(await storedSession()).toEqual(expected.keepsSession ? session : null);
  });
});

describe('expire (BR-ACC-05, BR-OFF-04)', () => {
  beforeEach(() => useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false }));

  it.each([
    {
      name: 'deletes the account’s data when every change has synced, e.g. after the account was deleted elsewhere',
      synced: true,
      kept: false,
    },
    { name: 'keeps unsynced changes for the next sign-in', synced: false, kept: true },
  ])('$name', async ({ synced, kept }) => {
    await finishedSetup();
    if (synced) {
      await syncedRecords();
    }
    await signedInWith(storedSessionFor(30_000));
    await useLocalData.getState().open(user.id);
    mockApi({ 'POST /auth/refresh': unauthenticated, 'GET /health': json(200, { status: 'ok' }) });

    await getHealth();

    await waitFor(() => expect(useAuth.getState().status).toBe('signedOut'));
    expect(hasDatabase(user.id)).toBe(kept);
  });
});

describe('refresh (BR-ACC-03)', () => {
  it.each([{ name: 'returns null without a request when signed out' }])('$name', async () => {
    useAuth.setState({ status: 'signedOut', session: null });
    const fetch = mockApi({});

    expect(await useAuth.getState().refresh()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('signIn (BR-ACC-01)', () => {
  it('stores the new session and signs in', async () => {
    const fetch = mockApi({ 'POST /auth/sign-in': signedIn() });

    await useAuth.getState().signIn('google', 'id-token');

    expect(requestBody(fetch)).toEqual({ provider: 'google', id_token: 'id-token' });
    expect(requestHeader(fetch, 'Authorization')).toBeNull();
    const expected = { accessToken: 'new-access', refreshToken: 'new-refresh', user };
    expect(useAuth.getState()).toMatchObject({ status: 'signedIn', session: expected });
    expect(await storedSession()).toMatchObject(expected);
  });

  it.each([
    {
      name: 'email_not_verified when the provider has not verified the email (BR-ACC-07)',
      respond: json(403, { code: 'email_not_verified', message: '' }),
      expected: 'email_not_verified',
    },
    {
      name: 'invalid_id_token for a rejected token',
      respond: json(401, { code: 'invalid_id_token', message: '' }),
      expected: 'invalid_id_token',
    },
    {
      name: 'unsupported_provider for a provider the server lacks',
      respond: json(400, { code: 'unsupported_provider', message: '' }),
      expected: 'unsupported_provider',
    },
    {
      name: 'unknown for any other error',
      respond: json(400, { code: 'invalid_request', message: '' }),
      expected: 'unknown',
    },
    { name: 'network when the API is unreachable', respond: offline, expected: 'network' },
  ])('fails with $name', async ({ respond, expected }) => {
    mockApi({ 'POST /auth/sign-in': respond });

    const error = await useAuth
      .getState()
      .signIn('google', 'id-token')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SignInError);
    expect((error as SignInError).code).toBe(expected);
    expect(useAuth.getState().status).toBe('restoring');
    expect(await storedSession()).toBeNull();
  });
});

describe('signOut (BR-ACC-04)', () => {
  it.each([
    { name: 'when the API ends the session', respond: noContent },
    { name: 'when offline, on the device only', respond: offline },
  ])('signs out $name', async ({ respond }) => {
    await signedInWith(storedSessionFor());
    queryClient.setQueryData(['private'], 'the previous user’s data');
    const fetch = mockApi({ 'POST /auth/sign-out': respond });

    await useAuth.getState().signOut();

    expect(requestHeader(fetch, 'Authorization')).toBe('Bearer stored-access');
    expect(useAuth.getState()).toMatchObject({ status: 'signedOut', session: null });
    expect(await storedSession()).toBeNull();
    expect(queryClient.getQueryData(['private'])).toBeUndefined();
  });

  it.each([{ name: 'without a request when there is no session' }])('signs out $name', async () => {
    useAuth.setState({ status: 'signedIn', session: null });
    const fetch = mockApi({});

    await useAuth.getState().signOut();

    expect(useAuth.getState().status).toBe('signedOut');
    expect(fetch).not.toHaveBeenCalled();
  });
});
