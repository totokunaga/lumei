import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with settings that come from the environment.
 *
 * Google Sign-In's config plugin needs the URL scheme of the Google iOS OAuth
 * client (`com.googleusercontent.apps.…`), and fails the build without one.
 * Until that client exists, leave `GOOGLE_IOS_URL_SCHEME` unset: the plugin
 * is skipped, and the app hides Google sign-in (see `src/auth/providers.ts`).
 * @returns The app config: app.json, plus the Google plugin when configured.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  const googlePlugin: [string, { iosUrlScheme: string }][] = googleIosUrlScheme
    ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }]]
    : [];

  return {
    ...config,
    name: config.name ?? 'Lumei',
    slug: config.slug ?? 'lumei',
    plugins: [...(config.plugins ?? []), ...googlePlugin],
  };
};
