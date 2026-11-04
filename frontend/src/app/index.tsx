import { useTranslation } from 'react-i18next';
import { Alert, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGetHealth } from '@/api/generated';
import { signOutOfDevice, unsyncedChanges } from '@/auth/sign-out';
import { useAuth } from '@/auth/store';
import { riseIn } from '@/components/motion';
import { CountingText } from '@/components/counting-text';
import { PressableScale } from '@/components/pressable-scale';
import { database } from '@/db/client';
import { readPeriodRecords, readSettings } from '@/db/records';
import { spendingBudget } from '@/domain/calculations';
import { localToday } from '@/domain/date';
import { type CurrencyCode, formatMoney } from '@/domain/money';
import { formatPeriodLabel } from '@/domain/period';

/**
 * Renders the home screen: the current period and its spending budget
 * (BR-CALC-02), whether the API is reachable, and the signed-in account with
 * a sign-out button (BR-ACC-04). Signing out with unsynced changes asks for
 * confirmation first, since they would be lost.
 */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const health = useGetHealth();
  const email = useAuth((s) => s.session?.user.email);

  const db = database();
  const currency = (readSettings(db)?.currency ?? 'USD') as CurrencyCode;
  const records = readPeriodRecords(db, localToday());

  let apiStatus = t('home.apiChecking');
  if (health.isError) {
    apiStatus = t('home.apiUnreachable');
  } else if (health.data) {
    apiStatus = t('home.apiStatus', { status: health.data.data.status });
  }

  /** Signs out, after a confirmation when unsynced changes would be lost. */
  const signOut = () => {
    const count = unsyncedChanges();
    if (count === 0) {
      void signOutOfDevice();
      return;
    }
    Alert.alert(t('home.signOutTitle'), t('home.signOutUnsynced', { count }), [
      { text: t('home.cancel'), style: 'cancel' },
      { text: t('home.signOut'), style: 'destructive', onPress: () => void signOutOfDevice() },
    ]);
  };

  return (
    <View
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
      className="flex-1 justify-between bg-white px-6 dark:bg-black"
    >
      <Animated.View entering={riseIn()} className="gap-6">
        <Text className="text-3xl font-bold text-black dark:text-white">{t('home.title')}</Text>
        {records ? (
          <View className="gap-2 rounded-3xl bg-emerald-50 p-6 dark:bg-emerald-950">
            <Text className="text-sm font-medium uppercase text-emerald-700 dark:text-emerald-300">
              {t('home.period')}
            </Text>
            <Text className="text-xl font-semibold text-black dark:text-white">
              {formatPeriodLabel(records.period, t, i18n.language)}
            </Text>
            <Text className="pt-2 text-sm font-medium uppercase text-emerald-700 dark:text-emerald-300">
              {t('home.budget')}
            </Text>
            <CountingText
              value={spendingBudget(records)}
              format={(amount) => formatMoney(amount, currency, i18n.language)}
              className="text-5xl font-bold text-emerald-700 dark:text-emerald-300"
            />
          </View>
        ) : (
          <Text className="text-base text-gray-500">{t('home.noPeriod')}</Text>
        )}
      </Animated.View>

      <View className="items-center gap-2">
        <Text className="text-sm text-gray-500">{apiStatus}</Text>
        {email && <Text className="text-sm text-gray-500">{t('home.signedInAs', { email })}</Text>}
        <PressableScale
          accessibilityRole="button"
          onPress={signOut}
          className="mt-2 rounded-full bg-gray-100 px-5 py-3 dark:bg-gray-900"
        >
          <Text className="text-base font-semibold text-black dark:text-white">
            {t('home.signOut')}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}
