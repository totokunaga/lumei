// Decides where a link into the app opens (Expo Router's native intent).

import { APPLE_RETURN_URL } from '@/auth/providers';

/**
 * Keeps the link that returns Sign in with Apple's web result to the app
 * (BR-ACC-01) on the sign-in screen: the sign-in itself reads it, and it
 * isn't a screen of its own. Every other link opens as usual.
 * @returns The path to open, e.g. `/sign-in`.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const returnPath = APPLE_RETURN_URL.replace(/^[a-z]+:\/\//, '');
  const opened = path.replace(/^[a-z]+:\/\//, '').replace(/^\//, '');
  return opened === returnPath || opened.startsWith(`${returnPath}?`) ? '/sign-in' : path;
}
