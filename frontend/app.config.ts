import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json with settings that come from the environment.
 *
 * Google Sign-In's config plugin needs the URL scheme of the Google iOS OAuth
 * client (`com.googleusercontent.apps.…`), and fails the build without one.
 * Until that client exists, leave `GOOGLE_IOS_URL_SCHEME` unset: the plugin
 * is skipped, and the app hides Google sign-in (see `src/auth/providers.ts`).
 * Google Maps on Android needs an API key (`GOOGLE_MAPS_API_KEY`). Without
 * one, Android shows an expense's location without a map
 * (`src/components/location-map.tsx`); iOS uses Apple Maps, which needs none.
 * @returns The app config: app.json, plus the Google plugin and Maps key when configured.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  const googlePlugin: [string, { iosUrlScheme: string }][] = googleIosUrlScheme
    ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }]]
    : [];

  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  return {
    ...config,
    name: config.name ?? 'Lumei',
    slug: config.slug ?? 'lumei',
    plugins: [...(config.plugins ?? []), ...googlePlugin],
    android: {
      ...config.android,
      ...(googleMapsApiKey ? { config: { googleMaps: { apiKey: googleMapsApiKey } } } : {}),
    },
    extra: { ...config.extra, googleMapsOnAndroid: !!googleMapsApiKey },
  };
};
