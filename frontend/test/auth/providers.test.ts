import type * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import type * as Providers from '@/auth/providers';

jest.mock('expo-apple-authentication', () => require('../helpers/apple-authentication'));

// One Google mock for every fresh load: `signInWithGoogle` imports the library
// only when it runs, after `loadProviders` has returned.
const mockGoogleSignin = {
  configure: jest.fn(),
  hasPlayServices: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
};
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: mockGoogleSignin,
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
}));

// Apple's web flow on Android (BR-ACC-01): a browser tab, and random secrets
// fixed here, so the state and nonce are known: every byte is 0xab.
const mockOpenAuthSession = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  getRandomBytes: (count: number) => new Uint8Array(count).fill(0xab),
  digestStringAsync: async (_algorithm: string, value: string) => `sha256(${value})`,
}));
const STATE = 'ab'.repeat(16);
const NONCE = 'ab'.repeat(32);

/** Where the app runs, and which Google client IDs it was built with. */
type Device = {
  os?: 'ios' | 'android';
  expoGo?: boolean;
  /** The Services ID of Apple's web flow; null when the build has none. */
  appleServicesId?: string | null;
  /** The API's URL; null for the development default. */
  apiUrl?: string | null;
  /** Null when the build has none. */
  webClientId?: string | null;
  /** Null when the build has none. */
  iosClientId?: string | null;
};

/** Sets an env var, or removes it for null. */
const setEnv = (key: string, value: string | null) => {
  if (value === null) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

/**
 * Loads `providers.ts` fresh on the given device, since it reads the
 * platform, Expo Go, and the client IDs when it loads.
 * @returns The module, and the Apple and Google mocks it calls.
 */
const loadProviders = ({
  os = 'ios',
  expoGo = false,
  webClientId = 'web-client-id',
  iosClientId = 'ios-client-id',
  appleServicesId = 'com.example.lumei.web',
  apiUrl = 'https://api.example.com',
}: Device = {}) => {
  setEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', webClientId);
  setEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', iosClientId);
  setEnv('EXPO_PUBLIC_APPLE_SERVICES_ID', appleServicesId);
  setEnv('EXPO_PUBLIC_API_URL', apiUrl);
  let loaded!: {
    providers: typeof Providers;
    apple: jest.Mocked<typeof AppleAuthentication>;
  };
  // react-native looks `Platform` up on each access, in the main module
  // registry, so replace it there rather than in the isolated one.
  jest.replaceProperty(Platform, 'OS', os);
  jest.isolateModules(() => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { executionEnvironment: expoGo ? 'storeClient' : 'bare' },
      ExecutionEnvironment: { StoreClient: 'storeClient', Bare: 'bare' },
    }));
    loaded = {
      providers: require('@/auth/providers'),
      apple: require('expo-apple-authentication'),
    };
  });
  return { ...loaded, google: { GoogleSignin: mockGoogleSignin } };
};

const canceled = Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' });

beforeEach(() => {
  Object.values(mockGoogleSignin).forEach((fn) => fn.mockReset());
  mockGoogleSignin.hasPlayServices.mockResolvedValue(true);
  mockGoogleSignin.signOut.mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe('isAppleSignInAvailable (BR-ACC-01)', () => {
  it.each<{ name: string; device: Device; supported: boolean; expected: boolean }>([
    { name: 'true on iOS when Apple supports it', device: {}, supported: true, expected: true },
    { name: 'false on iOS without support', device: {}, supported: false, expected: false },
    {
      name: 'true on Android with the Services ID and an HTTPS API',
      device: { os: 'android' },
      supported: false,
      expected: true,
    },
    {
      name: 'false on Android without the Services ID',
      device: { os: 'android', appleServicesId: null },
      supported: false,
      expected: false,
    },
    {
      name: 'false on Android against the local API, where Apple can’t return',
      device: { os: 'android', apiUrl: null },
      supported: false,
      expected: false,
    },
  ])('is $name', async ({ device, supported, expected }) => {
    const { providers, apple } = loadProviders(device);
    apple.isAvailableAsync.mockResolvedValue(supported);

    expect(await providers.isAppleSignInAvailable()).toBe(expected);
  });
});

describe('isGoogleSignInAvailable (BR-ACC-01)', () => {
  it.each<{ name: string; device: Device; expected: boolean }>([
    { name: 'true on iOS with both client IDs', device: {}, expected: true },
    {
      name: 'true on Android with the web client ID alone',
      device: { os: 'android', iosClientId: null },
      expected: true,
    },
    { name: 'false on iOS without the iOS client ID', device: { iosClientId: null }, expected: false },
    { name: 'false without the web client ID', device: { webClientId: null }, expected: false },
    { name: 'false in Expo Go, which lacks the native module', device: { expoGo: true }, expected: false },
  ])('is $name', ({ device, expected }) => {
    expect(loadProviders(device).providers.isGoogleSignInAvailable()).toBe(expected);
  });
});

describe('signInWithApple (BR-ACC-01, BR-ACC-05)', () => {
  it.each([
    {
      name: 'returns the identity token and authorization code, asking for the email',
      setup: (apple: jest.Mocked<typeof AppleAuthentication>) =>
        apple.signInAsync.mockResolvedValue({
          identityToken: 'apple-id-token',
          authorizationCode: 'apple-code',
        } as AppleAuthentication.AppleAuthenticationCredential),
      expected: { value: { idToken: 'apple-id-token', authorizationCode: 'apple-code' } },
    },
    {
      name: 'returns the identity token alone when Apple gives no code',
      setup: (apple: jest.Mocked<typeof AppleAuthentication>) =>
        apple.signInAsync.mockResolvedValue({
          identityToken: 'apple-id-token',
          authorizationCode: null,
        } as AppleAuthentication.AppleAuthenticationCredential),
      expected: { value: { idToken: 'apple-id-token', authorizationCode: undefined } },
    },
    {
      name: 'returns null when the user cancels',
      setup: (apple: jest.Mocked<typeof AppleAuthentication>) =>
        apple.signInAsync.mockRejectedValue(canceled),
      expected: { value: null },
    },
    {
      name: 'throws when Apple returns no token',
      setup: (apple: jest.Mocked<typeof AppleAuthentication>) =>
        apple.signInAsync.mockResolvedValue({
          identityToken: null,
        } as AppleAuthentication.AppleAuthenticationCredential),
      expected: { error: 'Sign in with Apple returned no identity token' },
    },
    {
      name: 'throws when Apple fails',
      setup: (apple: jest.Mocked<typeof AppleAuthentication>) =>
        apple.signInAsync.mockRejectedValue(new Error('Apple failed')),
      expected: { error: 'Apple failed' },
    },
  ])('$name', async ({ setup, expected }) => {
    const { providers, apple } = loadProviders();
    setup(apple);

    const result = providers.signInWithApple();

    if ('error' in expected) {
      await expect(result).rejects.toThrow(expected.error);
    } else {
      await expect(result).resolves.toEqual(expected.value);
    }
    expect(apple.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [apple.AppleAuthenticationScope.EMAIL],
    });
  });
});

describe('signInWithApple on Android, through Apple’s web flow (BR-ACC-01)', () => {
  beforeEach(() => mockOpenAuthSession.mockReset());

  /** The link the API sends the result back to, with `query`. */
  const returned = (query: Record<string, string>) => ({
    type: 'success',
    url: `lumei://apple-callback?${new URLSearchParams(query).toString()}`,
  });

  it.each([
    {
      name: 'returns the ID token, code, and the nonce the token carries a hash of',
      result: returned({ code: 'c-1', id_token: 'apple-web-token', state: STATE }),
      expected: { value: { idToken: 'apple-web-token', authorizationCode: 'c-1', nonce: NONCE } },
    },
    {
      name: 'returns null when the user closes the browser tab',
      result: { type: 'cancel' },
      expected: { value: null },
    },
    {
      name: 'returns null when the user cancels on Apple’s page',
      result: returned({ error: 'user_cancelled_authorize', state: STATE }),
      expected: { value: null },
    },
    {
      name: 'throws for an answer to another sign-in',
      result: returned({ code: 'c-1', id_token: 'someone-elses', state: 'other' }),
      expected: { error: 'answer to another sign-in' },
    },
    {
      name: 'throws when Apple fails',
      result: returned({ error: 'invalid_request', state: STATE }),
      expected: { error: 'Sign in with Apple failed: invalid_request' },
    },
  ])('$name', async ({ result, expected }) => {
    const { providers } = loadProviders({ os: 'android' });
    mockOpenAuthSession.mockResolvedValue(result);

    const credential = providers.signInWithApple();

    if ('error' in expected) {
      await expect(credential).rejects.toThrow(expected.error);
    } else {
      await expect(credential).resolves.toEqual(expected.value);
    }
    const [url, returnUrl] = mockOpenAuthSession.mock.calls[0] as [string, string];
    const sent = new URLSearchParams(url.split('?')[1]);
    expect(url.startsWith('https://appleid.apple.com/auth/authorize?')).toBe(true);
    expect(Object.fromEntries(sent)).toEqual({
      client_id: 'com.example.lumei.web',
      redirect_uri: 'https://api.example.com/auth/apple/callback',
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'email',
      state: STATE,
      // Apple gets only the nonce's hash; the app keeps the nonce.
      nonce: `sha256(${NONCE})`,
    });
    expect(returnUrl).toBe('lumei://apple-callback');
  });
});

describe('signInWithGoogle (BR-ACC-01, BR-ACC-05)', () => {
  it.each([
    {
      name: 'returns the ID token for the web client ID, and the server auth code',
      response: {
        type: 'success',
        data: { idToken: 'google-id-token', serverAuthCode: 'google-code' },
      },
      expected: { value: { idToken: 'google-id-token', authorizationCode: 'google-code' } },
    },
    {
      name: 'returns the ID token alone when Google gives no server auth code',
      response: { type: 'success', data: { idToken: 'google-id-token', serverAuthCode: null } },
      expected: { value: { idToken: 'google-id-token', authorizationCode: undefined } },
    },
    {
      name: 'returns null when the user cancels',
      response: { type: 'cancelled', data: null },
      expected: { value: null },
    },
    {
      name: 'throws when Google returns no token',
      response: { type: 'success', data: { idToken: null } },
      expected: { error: 'Sign in with Google returned no ID token' },
    },
  ])('$name', async ({ response, expected }) => {
    const { providers, google } = loadProviders();
    google.GoogleSignin.signIn.mockResolvedValue(response);

    const result = providers.signInWithGoogle();

    if ('error' in expected) {
      await expect(result).rejects.toThrow(expected.error);
    } else {
      await expect(result).resolves.toEqual(expected.value);
    }
    expect(google.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: 'web-client-id',
      iosClientId: 'ios-client-id',
      offlineAccess: true,
    });
  });
});

describe('signOutOfGoogle (BR-ACC-04)', () => {
  it.each<{ name: string; device: Device; fails: boolean; signsOut: boolean }>([
    { name: 'forgets the Google account', device: {}, fails: false, signsOut: true },
    { name: 'never fails when Google does', device: {}, fails: true, signsOut: true },
    { name: 'does nothing in Expo Go', device: { expoGo: true }, fails: false, signsOut: false },
  ])('$name', async ({ device, fails, signsOut }) => {
    const { providers, google } = loadProviders(device);
    if (fails) {
      google.GoogleSignin.signOut.mockRejectedValue(new Error('Google failed'));
    }

    await expect(providers.signOutOfGoogle()).resolves.toBeUndefined();

    expect(google.GoogleSignin.signOut).toHaveBeenCalledTimes(signsOut ? 1 : 0);
  });
});
