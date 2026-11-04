import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, TextInput, useColorScheme, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SignInProvider } from '@/api/generated/model';
import {
  isAppleSignInAvailable,
  isGoogleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
} from '@/auth/providers';
import { SignInError, useAuth, type SignInErrorCode } from '@/auth/store';
import { PressableScale } from '@/components/pressable-scale';

/**
 * Builds the entrance of the screen's `index`th block: it rises into place
 * on a spring, one block after another. With Reduce Motion on, it only fades.
 */
const entering = (index: number) =>
  FadeInDown.springify()
    .damping(18)
    .delay(120 + index * 90)
    .reduceMotion(ReduceMotion.System);

/**
 * Renders the sign-in screen (BR-ACC-01): Sign in with Apple on iOS, Sign in
 * with Google where it is configured, and in development builds a sign-in
 * with any email. A failed sign-in shows why; a cancelled one shows nothing.
 */
export default function SignInScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const signIn = useAuth((s) => s.signIn);

  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInErrorCode | null>(null);
  const [devEmail, setDevEmail] = useState('');

  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  /**
   * Gets an ID token from a provider and signs in with it, showing the
   * error if either step fails.
   * @param getIdToken Returns the token, or null if the user cancelled.
   */
  const run = async (provider: SignInProvider, getIdToken: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      if (idToken) {
        await signIn(provider, idToken);
      }
    } catch (e) {
      setError(e instanceof SignInError ? e.code : 'unknown');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View
      className="flex-1 bg-white px-6 dark:bg-black"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 24 }}
    >
      <View className="flex-1 justify-center gap-3">
        <Animated.Text
          entering={entering(0)}
          className="text-6xl font-extrabold tracking-tight text-black dark:text-white"
        >
          {t('home.title')}
        </Animated.Text>
        <Animated.Text
          entering={entering(1)}
          className="text-xl font-medium text-gray-500 dark:text-gray-400"
        >
          {t('signIn.tagline')}
        </Animated.Text>
      </View>

      <Animated.View entering={entering(2)} className="gap-3">
        {error && (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            className="text-center text-base text-red-600 dark:text-red-400"
          >
            {t(`signIn.errors.${error}`)}
          </Text>
        )}

        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={
              dark
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={16}
            style={{ width: '100%', height: 52, opacity: busy ? 0.5 : 1 }}
            onPress={() => !busy && run('apple', signInWithApple)}
          />
        )}

        {isGoogleSignInAvailable() && (
          <PressableScale
            accessibilityRole="button"
            disabled={busy}
            onPress={() => run('google', signInWithGoogle)}
            className="h-[52px] items-center justify-center rounded-2xl border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
          >
            <Text className="text-lg font-semibold text-black dark:text-white">
              {t('signIn.google')}
            </Text>
          </PressableScale>
        )}

        {__DEV__ && (
          <View className="gap-2 rounded-2xl border border-dashed border-gray-300 p-3 dark:border-gray-700">
            <Text className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t('signIn.devTitle')}
            </Text>
            <TextInput
              accessibilityLabel={t('signIn.devEmail')}
              placeholder={t('signIn.devEmail')}
              placeholderTextColor="#9ca3af"
              value={devEmail}
              onChangeText={setDevEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              className="h-12 rounded-xl bg-gray-100 px-4 text-base text-black dark:bg-gray-900 dark:text-white"
            />
            <PressableScale
              accessibilityRole="button"
              disabled={busy || !devEmail.trim()}
              onPress={() => run('dev', async () => devEmail.trim())}
              className="h-12 items-center justify-center rounded-xl bg-black dark:bg-white"
            >
              <Text className="text-base font-semibold text-white dark:text-black">
                {t('signIn.devSubmit')}
              </Text>
            </PressableScale>
          </View>
        )}

        {busy && <ActivityIndicator accessibilityLabel={t('signIn.signingIn')} />}
      </Animated.View>
    </View>
  );
}
