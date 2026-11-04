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

/** Where the app runs, and which Google client IDs it was built with. */
type Device = {
  os?: 'ios' | 'android';
  expoGo?: boolean;
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
}: Device = {}) => {
  setEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', webClientId);
  setEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', iosClientId);
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
  it.each([
    { name: 'true on iOS when Apple supports it', os: 'ios', supported: true, expected: true },
    { name: 'false on iOS without support', os: 'ios', supported: false, expected: false },
    { name: 'false on Android for now', os: 'android', supported: true, expected: false },
  ] as const)('is $name', async ({ os, supported, expected }) => {
    const { providers, apple } = loadProviders({ os });
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

describe('signInWithApple (BR-ACC-01)', () => {
  it.each([
    {
      name: 'returns the identity token, asking for the email',
      setup: (apple: jest.Mocked<typeof AppleAuthentication>) =>
        apple.signInAsync.mockResolvedValue({
          identityToken: 'apple-id-token',
        } as AppleAuthentication.AppleAuthenticationCredential),
      expected: { value: 'apple-id-token' },
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
      await expect(result).resolves.toBe(expected.value);
    }
    expect(apple.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [apple.AppleAuthenticationScope.EMAIL],
    });
  });
});

describe('signInWithGoogle (BR-ACC-01)', () => {
  it.each([
    {
      name: 'returns the ID token for the web client ID',
      response: { type: 'success', data: { idToken: 'google-id-token' } },
      expected: { value: 'google-id-token' },
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
      await expect(result).resolves.toBe(expected.value);
    }
    expect(google.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: 'web-client-id',
      iosClientId: 'ios-client-id',
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
