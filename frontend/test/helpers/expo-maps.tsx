// Stands in for expo-maps, whose map views are native: a map is a plain view
// with the test ID "map" that fires `onMapClick` as a "mapClick" event, e.g.
// `fireEvent(screen.getByTestId('map'), 'mapClick', { coordinates })`.
import { View } from 'react-native';

/** Renders a map's stand-in, keeping its props for tests to inspect. */
const MapView = (props: object) => <View testID="map" {...props} />;

export const AppleMaps = { View: MapView };
export const GoogleMaps = { View: MapView };
