// Gets ID tokens from Sign in with Apple and Google on the device (BR-ACC-01).
// The app sends them to `POST /auth/sign-in`, which verifies them.
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { API_URL } from '@/api/client';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/**
 * What a provider's sign-in hands the app: the ID token the API verifies,
 * and the one-time code the API trades for a token that revokes the app's
 * access when the account is deleted (BR-ACC-05). The code is missing when
 * the provider didn't return one.
 */
export interface ProviderCredential {
  idToken: string;
  authorizationCode?: string;
  /** The secret whose hash the token carries, for Apple's web flow on Android. */
  nonce?: string;
}

/** The Services ID of Sign in with Apple's web flow, which Android uses. */
const appleServicesId = process.env.EXPO_PUBLIC_APPLE_SERVICES_ID;

/**
 * The app link `POST /auth/apple/callback` sends the web flow's result to;
 * the API's `AUTH_APPLE_APP_REDIRECT_URL`.
 */
export const APPLE_RETURN_URL = 'lumei://apple-callback';

/** Expo Go lacks Google Sign-In's native module; a development build has it. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Checks whether Sign in with Apple can be offered (BR-ACC-01): natively on
 * iOS, and on Android through Apple's web flow, which needs the Services ID
 * and an API Apple can return to over HTTPS.
 * @returns True on an iOS version that supports it, or on Android when configured.
 */
export const isAppleSignInAvailable = async (): Promise<boolean> =>
  Platform.OS === 'ios'
    ? AppleAuthentication.isAvailableAsync()
    : !!appleServicesId && API_URL.startsWith('https://');

/**
 * Checks whether Sign in with Google can be offered: the Google client IDs
 * are configured, and the app isn't running in Expo Go.
 * @returns True if `signInWithGoogle` can work.
 */
export const isGoogleSignInAvailable = (): boolean =>
  !isExpoGo && !!googleWebClientId && (Platform.OS !== 'ios' || !!googleIosClientId);

/**
 * Makes a random secret.
 * @returns `bytes` random bytes in hex, e.g. 64 characters for 32.
 */
const randomHex = (bytes: number): string =>
  Array.from(Crypto.getRandomBytes(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Signs in with Apple's web flow, on Android (BR-ACC-01). Apple's page opens
 * in a browser tab, posts its result to the API, which sends it back to the
 * app through `APPLE_RETURN_URL`. The app gives Apple the hash of a nonce
 * and keeps the nonce, so a token another app catches on its way back is of
 * no use; and it checks the state it sent, so the answer is its own.
 * @returns The ID token, authorization code, and nonce, or null if the user cancelled.
 * @throws If Apple fails, or the answer isn't this sign-in's.
 */
const signInWithAppleOnWeb = async (): Promise<ProviderCredential | null> => {
  const nonce = randomHex(32);
  const state = randomHex(16);
  const params = new URLSearchParams({
    client_id: appleServicesId ?? '',
    redirect_uri: `${API_URL}/auth/apple/callback`,
    response_type: 'code id_token',
    // Apple sends the email address only by posting the result.
    response_mode: 'form_post',
    scope: 'email',
    state,
    nonce: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce),
  });
  const result = await WebBrowser.openAuthSessionAsync(
    `https://appleid.apple.com/auth/authorize?${params.toString()}`,
    APPLE_RETURN_URL,
  );
  if (result.type !== 'success') {
    return null;
  }
  const answer = Linking.parse(result.url).queryParams ?? {};
  const field = (name: string): string | undefined =>
    typeof answer[name] === 'string' ? answer[name] : undefined;
  if (field('state') !== state) {
    throw new Error('Sign in with Apple returned an answer to another sign-in');
  }
  if (field('error') === 'user_cancelled_authorize') {
    return null;
  }
  const idToken = field('id_token');
  if (!idToken) {
    throw new Error(`Sign in with Apple failed: ${field('error') ?? 'no identity token'}`);
  }
  return { idToken, authorizationCode: field('code'), nonce };
};

/**
 * Shows Apple's sign-in sheet on iOS, or Apple's sign-in page on Android,
 * asking for the email address.
 * @returns Apple's ID token and authorization code, or null if the user cancelled.
 * @throws If Apple fails, or returns no token.
 */
export const signInWithApple = async (): Promise<ProviderCredential | null> => {
  if (Platform.OS !== 'ios') {
    return signInWithAppleOnWeb();
  }
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) {
      throw new Error('Sign in with Apple returned no identity token');
    }
    return {
      idToken: credential.identityToken,
      authorizationCode: credential.authorizationCode ?? undefined,
    };
  } catch (error) {
    if (isErrorWithCode(error, 'ERR_REQUEST_CANCELED')) {
      return null;
    }
    throw error;
  }
};

/**
 * Shows Google's account picker. The library is loaded only here, so merely
 * importing this file works in Expo Go, which lacks its native module. It
 * asks for offline access, so Google also returns a server auth code
 * (BR-ACC-05).
 * @returns Google's ID token for the web client ID and its server auth code,
 *   or null if the user cancelled.
 * @throws If Google fails, or returns no token.
 */
export const signInWithGoogle = async (): Promise<ProviderCredential | null> => {
  const { GoogleSignin, isSuccessResponse } =
    await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({
    webClientId: googleWebClientId,
    iosClientId: googleIosClientId,
    offlineAccess: true,
  });
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    return null;
  }
  if (!response.data.idToken) {
    throw new Error('Sign in with Google returned no ID token');
  }
  return {
    idToken: response.data.idToken,
    authorizationCode: response.data.serverAuthCode ?? undefined,
  };
};

/**
 * Forgets the Google account, so the next Google sign-in shows the account
 * picker instead of reusing it. It does nothing where Google isn't offered,
 * and never fails: signing out of Lumei mustn't depend on it.
 */
export const signOutOfGoogle = async (): Promise<void> => {
  if (!isGoogleSignInAvailable()) {
    return;
  }
  try {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
  } catch {
    // The Lumei session is gone either way.
  }
};

/**
 * Checks whether an error from a native module has the given code.
 * @returns True if `error` is an object whose `code` equals `code`.
 */
const isErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;
