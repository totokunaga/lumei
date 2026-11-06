import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signOutOfDevice, syncBeforeSignOut } from '@/auth/sign-out';
import { useAuth } from '@/auth/store';
import { LanguagePicker } from '@/components/language-picker';
import { PressableScale } from '@/components/pressable-scale';
import { SelectRow } from '@/components/select-row';
import { SettingsRow } from '@/components/settings-row';
import { useDataVersion } from '@/db/changes';
import { database } from '@/db/client';
import {
  countFailedChanges,
  countPendingChanges,
  readSettings,
  setBigPurchaseSpread,
} from '@/db/records';
import type { BigPurchaseSpread } from '@/domain/calculations';
import { TAB_BAR_CLEARANCE } from '@/lib/layout';
import { useSyncStatus } from '@/sync/scheduler';

/** Renders a titled group of settings. */
function Section({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text
        accessibilityRole="header"
        className="px-1 text-sm font-medium uppercase text-gray-500 dark:text-gray-400"
      >
        {title}
      </Text>
      <View className="gap-2">{children}</View>
      {footer && <Text className="px-1 text-sm text-gray-500 dark:text-gray-400">{footer}</Text>}
    </View>
  );
}

/**
 * Renders the Settings tab: the period start day (BR-PER-05), how big
 * purchases are spread on the charts (BR-SET-05), the app language
 * (BR-SET-01), and the account: whether every change has synced (BR-OFF-04)
 * and signing out (BR-ACC-04). Signing out first tries to sync the unsynced
 * changes, and asks for confirmation if some still haven't, since they would
 * be lost.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const email = useAuth((s) => s.session?.user.email);
  const syncing = useSyncStatus((s) => s.syncing);
  const version = useDataVersion();
  const [signingOut, setSigningOut] = useState(false);

  // Read again after every write, including the sync engine's.
  const data = useMemo(() => {
    const db = database();
    return {
      settings: readSettings(db),
      pending: countPendingChanges(db),
      failed: countFailedChanges(db),
    };
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

  const syncStatus =
    data.pending === 0
      ? t('account.allSynced')
      : syncing
        ? t('account.syncing')
        : t('account.unsynced', { count: data.pending });

  const spread = (data.settings?.bigPurchaseSpread ?? 'daysLeft') as BigPurchaseSpread;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="gap-8 px-6 pt-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
    >
      {data.settings && (
        <Section title={t('settings.budget')} footer={t(`settings.spread.${spread}Hint`)}>
          <SettingsRow
            label={t('settings.startDay.label')}
            value={t('setup.startDay.day', { day: data.settings.periodStartDay })}
            onPress={() => router.push('/settings/start-day')}
          />
          <SelectRow
            label={t('settings.spread.label')}
            options={[
              { value: 'daysLeft', label: t('settings.spread.daysLeft') },
              { value: 'wholePeriod', label: t('settings.spread.wholePeriod') },
            ]}
            value={spread}
            onChange={(value) => setBigPurchaseSpread(database(), value, Date.now())}
          />
        </Section>
      )}

      <Section title={t('settings.app')}>
        <LanguagePicker />
      </Section>

      <Section title={t('account.title')}>
        <View accessible className="gap-1 rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-900">
          {email && (
            <Text className="text-base text-black dark:text-white">
              {t('account.signedInAs', { email })}
            </Text>
          )}
          <Text className="text-sm text-gray-500 dark:text-gray-400">{syncStatus}</Text>
          {data.failed > 0 && (
            <Text className="text-sm text-red-600 dark:text-red-400">
              {t('account.failed', { count: data.failed })}
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
      </Section>
    </ScrollView>
  );
}
