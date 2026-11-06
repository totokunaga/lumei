import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExpenseRow } from '@/components/expense-row';
import { QuickAddButton } from '@/components/quick-add-button';
import { TodayCard } from '@/components/today-card';
import { useDataVersion } from '@/db/changes';
import { database } from '@/db/client';
import { readPeriodExpenses, readPeriodOn, readPeriodRecords, readSettings } from '@/db/records';
import { useToday } from '@/db/use-today';
import { periodSummary, todayStatus } from '@/domain/calculations';
import { type CurrencyCode, formatMoney, type Minor } from '@/domain/money';
import { formatPeriodRange } from '@/domain/period';
import { TAB_BAR_CLEARANCE } from '@/lib/layout';

/**
 * Renders the home screen: the current period's dates as its title, today's
 * numbers (BR-DSH-01, BR-DSH-02) in a card that expands to the period
 * summary (BR-DSH-03), the period's expenses newest first (BR-DSH-06), and
 * the button that records an expense (BR-EXP-09). Every number is worked out on the device from the
 * account's records (BR-OFF-02), and updates as soon as a record changes
 * (BR-DSH-04, BR-NFR-04) and at local midnight (BR-DSH-05). It is the
 * Home tab.
 */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const version = useDataVersion();

  const data = useMemo(() => {
    const db = database();
    const records = readPeriodRecords(db, today);
    return {
      currency: (readSettings(db)?.currency ?? 'USD') as CurrencyCode,
      records,
      periodId: readPeriodOn(db, today)?.id ?? null,
      expenses: readPeriodExpenses(db, today),
      status: records && todayStatus(records, today),
      summary: records && periodSummary(records, today),
    };
    // `version` changes with every write, so the records are read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, version]);
  const money = (amount: Minor) => formatMoney(amount, data.currency, i18n.language);

  const header = (
    <View className="gap-6 pb-3">
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        adjustsFontSizeToFit
        className="text-3xl font-bold text-black dark:text-white"
      >
        {data.records ? formatPeriodRange(data.records.period, t, i18n.language) : t('home.today')}
      </Text>

      {data.records && data.status && data.summary ? (
        <>
          <TodayCard
            status={data.status}
            summary={data.summary}
            money={money}
            onEdit={(item) => data.periodId && router.push(`/period/${data.periodId}/${item}`)}
          />
          <Text
            accessibilityRole="header"
            className="px-1 pt-2 text-xl font-bold text-black dark:text-white"
          >
            {t('home.expenses')}
          </Text>
        </>
      ) : (
        <Text className="text-base text-gray-500">{t('home.noPeriod')}</Text>
      )}
    </View>
  );

  return (
    <View className="flex-1 bg-white dark:bg-black">
      {/* One list for the whole screen, so the cards scroll away with the expenses (BR-DSH-06). */}
      <FlashList
        data={data.expenses}
        keyExtractor={(expense) => expense.id}
        renderItem={({ item }) => <ExpenseRow expense={item} today={today} money={money} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          data.records ? (
            <Text className="px-1 py-3 text-base text-gray-500 dark:text-gray-400">
              {t('home.noExpenses')}
            </Text>
          ) : null
        }
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 88,
          paddingHorizontal: 24,
        }}
      />

      {data.records && (
        <View
          pointerEvents="box-none"
          style={{ bottom: insets.bottom + TAB_BAR_CLEARANCE + 16 }}
          className="absolute right-6"
        >
          <QuickAddButton onPress={() => router.push('/expense/new')} />
        </View>
      )}
    </View>
  );
}

/** Renders the hairline between two expenses, starting under their text rather than the emoji. */
function Separator() {
  return <View className="ml-[60px] h-px bg-gray-200 dark:bg-gray-800" />;
}
