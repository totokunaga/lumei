import '@/global.css';
import '@/i18n';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { useAuth } from '@/auth/store';
import { PressableScale } from '@/components/pressable-scale';
import { useLocalData } from '@/db/store';
import { queryClient } from '@/lib/query-client';
import { useSetupDraft } from '@/setup/draft';

// Keep the splash screen up until the stored session and the account's data
// have been read, so neither the sign-in screen nor setup flashes for a user
// who doesn't need them.
void SplashScreen.preventAutoHideAsync();

/**
 * Renders the root navigator inside the providers every screen needs
 * (TanStack Query). Signed-out users reach only the sign-in screen. Signed-in
 * users reach setup until they finish it, and then every other screen
 * (BR-ACC-03, BR-ACC-06). It opens the account's database on sign-in and
 * closes it on sign-out or expiry. It renders nothing while the session or
 * the database is being read, and a retry if the database can't be opened.
 */
export default function RootLayout() {
  const { t } = useTranslation();
  const status = useAuth((s) => s.status);
  const userId = useAuth((s) => s.session?.user.id);
  const data = useLocalData((s) => s.status);
  const setupCompleted = useLocalData((s) => s.setupCompleted);

  useEffect(() => {
    void useAuth.getState().restore();
  }, []);

  useEffect(() => {
    if (status === 'signedIn' && userId) {
      void useLocalData.getState().open(userId);
    } else if (status === 'signedOut') {
      useLocalData.getState().close();
      useSetupDraft.getState().reset();
    }
  }, [status, userId]);

  const loading =
    status === 'restoring' || (status === 'signedIn' && data !== 'ready' && data !== 'failed');

  useEffect(() => {
    if (!loading) {
      void SplashScreen.hideAsync();
    }
  }, [loading]);

  if (loading) {
    return null;
  }

  if (status === 'signedIn' && data === 'failed') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-white px-8 dark:bg-black">
        <Text accessibilityRole="alert" className="text-center text-lg text-black dark:text-white">
          {t('data.openFailed')}
        </Text>
        <PressableScale
          accessibilityRole="button"
          onPress={() => userId && void useLocalData.getState().open(userId)}
          className="rounded-full bg-gray-100 px-5 py-3 dark:bg-gray-900"
        >
          <Text className="text-base font-semibold text-black dark:text-white">
            {t('data.retry')}
          </Text>
        </PressableScale>
      </View>
    );
  }

  const signedIn = status === 'signedIn';

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn && setupCompleted}>
          <Stack.Screen name="index" />
          <Stack.Screen name="expense/new" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="account"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: 'fitToContents',
              sheetGrabberVisible: true,
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !setupCompleted}>
          <Stack.Screen name="setup" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
