// Gets ID tokens from Sign in with Apple and Google on the device (BR-ACC-01).
// The app sends them to `POST /auth/sign-in`, which verifies them.
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** Expo Go lacks Google Sign-In's native module; a development build has it. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Checks whether Sign in with Apple can be offered. It is iOS only for now:
 * Android needs a web flow that comes later (BR-ACC-01).
 * @returns True on an iOS version that supports it.
 */
export const isAppleSignInAvailable = async (): Promise<boolean> =>
  Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync());

/**
 * Checks whether Sign in with Google can be offered: the Google client IDs
 * are configured, and the app isn't running in Expo Go.
 * @returns True if `signInWithGoogle` can work.
 */
export const isGoogleSignInAvailable = (): boolean =>
  !isExpoGo && !!googleWebClientId && (Platform.OS !== 'ios' || !!googleIosClientId);

/**
 * Shows Apple's sign-in sheet, asking for the email address.
 * @returns Apple's ID token, or null if the user cancelled.
 * @throws If Apple fails, or returns no token.
 */
export const signInWithApple = async (): Promise<string | null> => {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) {
      throw new Error('Sign in with Apple returned no identity token');
    }
    return credential.identityToken;
  } catch (error) {
    if (isErrorWithCode(error, 'ERR_REQUEST_CANCELED')) {
      return null;
    }
    throw error;
  }
};

/**
 * Shows Google's account picker. The library is loaded only here, so merely
 * importing this file works in Expo Go, which lacks its native module.
 * @returns Google's ID token for the web client ID, or null if the user cancelled.
 * @throws If Google fails, or returns no token.
 */
export const signInWithGoogle = async (): Promise<string | null> => {
  const { GoogleSignin, isSuccessResponse } =
    await import('@react-native-google-signin/google-signin');
  GoogleSignin.configure({ webClientId: googleWebClientId, iosClientId: googleIosClientId });
  await GoogleSignin.hasPlayServices();
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    return null;
  }
  if (!response.data.idToken) {
    throw new Error('Sign in with Google returned no ID token');
  }
  return response.data.idToken;
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
