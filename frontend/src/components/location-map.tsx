import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Platform, Text, View } from 'react-native';

import type { Coordinates } from '@/lib/location';

/**
 * Loads the native map views, or returns null where there are none: Expo Go
 * lacks expo-maps' native module, and Android needs a Google Maps API key
 * (see app.config.ts).
 * @returns expo-maps, loaded only where it exists: importing it in Expo Go would fail.
 */
const loadMaps = (): typeof import('expo-maps') | null =>
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Platform.OS === 'android' && !Constants.expoConfig?.extra?.googleMapsOnAndroid)
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-maps');

/** How close the map starts, showing a few streets around the pin. */
const ZOOM = 15;

/** Props of `LocationMap`. */
interface LocationMapProps {
  location: Coordinates;
  /** Moves the pin to where the user tapped. */
  onMove: (location: Coordinates) => void;
}

/**
 * Renders where an expense happened (BR-EXP-04): a map centered on its pin,
 * Apple Maps on iOS and Google Maps on Android, where tapping moves the pin.
 * Without a map (Expo Go, or Android without a Maps key), it shows the
 * coordinates instead, which can still be removed.
 */
export function LocationMap({ location, onMove }: LocationMapProps) {
  const { t, i18n } = useTranslation();
  const maps = loadMaps();
  const place = t('expense.coordinates', {
    latitude: location.latitude.toLocaleString(i18n.language, { maximumFractionDigits: 4 }),
    longitude: location.longitude.toLocaleString(i18n.language, { maximumFractionDigits: 4 }),
  });

  if (!maps) {
    return (
      <View
        accessible
        accessibilityLabel={place}
        className="h-20 flex-row items-center gap-3 rounded-2xl bg-gray-100 px-4 dark:bg-gray-900"
      >
        <Text className="text-2xl">📍</Text>
        <Text className="text-base text-gray-600 dark:text-gray-400">{place}</Text>
      </View>
    );
  }

  const camera = { coordinates: location, zoom: ZOOM };
  const marker = { id: 'expense', coordinates: location };
  /** Moves the pin to a tapped point. */
  const move = (event: { coordinates: { latitude?: number; longitude?: number } }) => {
    const { latitude, longitude } = event.coordinates;
    if (latitude !== undefined && longitude !== undefined) {
      onMove({ latitude, longitude });
    }
  };

  return (
    <View
      accessible
      accessibilityLabel={place}
      accessibilityHint={t('expense.moveHint')}
      className="h-48 overflow-hidden rounded-2xl"
    >
      {Platform.OS === 'ios' ? (
        <maps.AppleMaps.View
          style={{ flex: 1 }}
          cameraPosition={camera}
          markers={[{ ...marker, tintColor: '#10B981' }]}
          onMapClick={move}
        />
      ) : (
        <maps.GoogleMaps.View
          style={{ flex: 1 }}
          cameraPosition={camera}
          markers={[marker]}
          onMapClick={move}
        />
      )}
    </View>
  );
}
