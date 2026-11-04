import '@/global.css';
import '@/i18n';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { useAuth } from '@/auth/store';
import { queryClient } from '@/lib/query-client';

// Keep the splash screen up until the stored session has been read, so the
// sign-in screen never flashes for a user who is already signed in.
void SplashScreen.preventAutoHideAsync();

/**
 * Renders the root navigator inside the providers every screen needs
 * (TanStack Query). Signed-out users can reach only the sign-in screen, and
 * signed-in users every screen but it (BR-ACC-03). It renders nothing while
 * the stored session is being read.
 */
export default function RootLayout() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    void useAuth.getState().restore();
  }, []);

  useEffect(() => {
    if (status !== 'restoring') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  if (status === 'restoring') {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="index" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
