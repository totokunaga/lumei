import { Stack } from 'expo-router';
import { View } from 'react-native';

import { SetupHeader } from '@/components/setup-header';

/**
 * Renders setup as a native stack under one header (BR-ACC-06): the header's
 * back button and progress bar stay in place, while each step slides in from
 * the side going forward and back out going back, and swiping back returns
 * to the previous step.
 */
export default function SetupLayout() {
  return (
    <View className="flex-1 bg-white dark:bg-black">
      <SetupHeader />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </View>
  );
}
