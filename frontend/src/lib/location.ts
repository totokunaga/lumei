// The device's location, for recording where an expense happened (BR-EXP-04).
// It is read only while an expense is being recorded, never in the background
// (BR-NFR-01), and only with the user's permission.
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

/** A point on the map, in degrees. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Whether the app may read the location: not asked yet, allowed, or refused. */
export type LocationAccess = 'undetermined' | 'granted' | 'denied';

/**
 * Asks for location access, if the user hasn't answered yet, and reads the
 * location. The last known position comes first, as it is instant; a fresh
 * one follows.
 * @param ask Whether to ask for permission if it hasn't been answered.
 * @param onLocation Receives each position read, the last known one first.
 * @returns Whether access was granted.
 */
export const readLocation = async (
  ask: boolean,
  onLocation: (location: Coordinates) => void,
): Promise<LocationAccess> => {
  let { status } = await Location.getForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.UNDETERMINED && ask) {
    ({ status } = await Location.requestForegroundPermissionsAsync());
  }
  if (status !== Location.PermissionStatus.GRANTED) {
    return status === Location.PermissionStatus.DENIED ? 'denied' : 'undetermined';
  }
  const known = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
  if (known) {
    onLocation(known.coords);
  }
  const fresh = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  }).catch(() => null);
  if (fresh) {
    onLocation(fresh.coords);
  }
  return 'granted';
};

/**
 * Captures the device's location while a new expense is being recorded
 * (BR-EXP-04): asks for permission the first time, then reads the location.
 * Saving never waits for it.
 * @param enabled False to read nothing, e.g. when editing a saved expense.
 * @returns The location so far, or null; and whether access was granted.
 */
export const useCaptureLocation = (
  enabled: boolean,
): { location: Coordinates | null; access: LocationAccess } => {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [access, setAccess] = useState<LocationAccess>('undetermined');
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    void readLocation(true, (coords) => {
      if (active) {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
      }
    })
      .then((result) => active && setAccess(result))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled]);
  return { location, access };
};
