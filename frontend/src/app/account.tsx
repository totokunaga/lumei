import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOutOfDevice, syncBeforeSignOut } from '@/auth/sign-out';
import { useAuth } from '@/auth/store';
import { PressableScale } from '@/components/pressable-scale';
import { useDataVersion } from '@/db/changes';
import { database } from '@/db/client';
import { countFailedChanges, countPendingChanges } from '@/db/records';
import { useSyncStatus } from '@/sync/scheduler';

/**
 * Renders the account sheet: the signed-in account, whether every change has
 * synced (BR-OFF-04), and a sign-out button (BR-ACC-04). Signing out first
 * tries to sync the unsynced changes, and asks for confirmation if some
 * still haven't, since they would be lost.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const email = useAuth((s) => s.session?.user.email);
  const syncing = useSyncStatus((s) => s.syncing);
  const version = useDataVersion();
  const [signingOut, setSigningOut] = useState(false);

  // Read again after every write, including the sync engine's.
  const counts = useMemo(() => {
    const db = database();
    return { pending: countPendingChanges(db), failed: countFailedChanges(db) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  /** Signs out, after syncing, and a confirmation when unsynced changes would be lost. */
  const signOut = async () => {
    setSigningOut(true);
    const count = await syncBeforeSignOut();
    if (count === 0) {
      void signOutOfDevice();
      return;
    }
    setSigningOut(false);
    Alert.alert(t('account.signOutTitle'), t('account.signOutUnsynced', { count }), [
      { text: t('account.cancel'), style: 'cancel' },
      { text: t('account.signOut'), style: 'destructive', onPress: () => void signOutOfDevice() },
    ]);
  };

  const status =
    counts.pending === 0
      ? t('account.allSynced')
      : syncing
        ? t('account.syncing')
        : t('account.unsynced', { count: counts.pending });

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
      <View accessible className="gap-1">
        <Text className="text-base text-black dark:text-white">{status}</Text>
        {counts.failed > 0 && (
          <Text className="text-sm text-red-600 dark:text-red-400">
            {t('account.failed', { count: counts.failed })}
          </Text>
        )}
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ busy: signingOut, disabled: signingOut }}
        disabled={signingOut}
        onPress={() => void signOut()}
        className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-gray-100 dark:bg-gray-900"
      >
        {signingOut && <ActivityIndicator />}
        <Text className="text-lg font-semibold text-red-600 dark:text-red-400">
          {t('account.signOut')}
        </Text>
      </PressableScale>
    </View>
  );
}
