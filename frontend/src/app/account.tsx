import { useTranslation } from 'react-i18next';
import { Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOutOfDevice, unsyncedChanges } from '@/auth/sign-out';
import { useAuth } from '@/auth/store';
import { PressableScale } from '@/components/pressable-scale';

/**
 * Renders the account sheet: the signed-in account and a sign-out button
 * (BR-ACC-04). Signing out with unsynced changes asks for confirmation first,
 * since they would be lost.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const email = useAuth((s) => s.session?.user.email);

  /** Signs out, after a confirmation when unsynced changes would be lost. */
  const signOut = () => {
    const count = unsyncedChanges();
    if (count === 0) {
      void signOutOfDevice();
      return;
    }
    Alert.alert(t('account.signOutTitle'), t('account.signOutUnsynced', { count }), [
      { text: t('account.cancel'), style: 'cancel' },
      { text: t('account.signOut'), style: 'destructive', onPress: () => void signOutOfDevice() },
    ]);
  };

  return (
    <View
      style={{ paddingBottom: insets.bottom + 16 }}
      className="gap-6 bg-white px-6 pt-8 dark:bg-black"
    >
      <View className="gap-1">
        <Text accessibilityRole="header" className="text-3xl font-bold text-black dark:text-white">
          {t('account.title')}
        </Text>
        {email && (
          <Text className="text-base text-gray-500 dark:text-gray-400">
            {t('account.signedInAs', { email })}
          </Text>
        )}
      </View>
      <PressableScale
        accessibilityRole="button"
        onPress={signOut}
        className="h-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-900"
      >
        <Text className="text-lg font-semibold text-red-600 dark:text-red-400">
          {t('account.signOut')}
        </Text>
      </PressableScale>
    </View>
  );
}
