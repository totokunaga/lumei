import { Stack } from 'expo-router';

/**
 * Renders the setup steps as a native stack (BR-ACC-06): each step slides in
 * from the side, and swiping back returns to the previous one. Each step draws
 * its own header with `SetupStep`.
 */
export default function SetupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
