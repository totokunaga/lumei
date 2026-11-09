// Hides development warnings from libraries that the app can't fix itself.
// LogBox shows only in development builds, and the warnings still reach the
// console (Metro's terminal), so nothing is hidden from a debugging session.
import { LogBox } from 'react-native';

LogBox.ignoreLogs([
  // NativeWind's runtime (react-native-css-interop) registers React Native's
  // ImageBackground when it loads, which triggers this deprecation warning.
  // The app doesn't use ImageBackground. Remove once NativeWind stops touching it.
  'ImageBackground is deprecated',
]);
