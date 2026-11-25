import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CountingText } from '@/components/counting-text';
import { deleteExpenseWithUndo } from '@/components/delete-expense';
import { ExpenseRow } from '@/components/expense-row';
import { riseIn } from '@/components/motion';
import { PressableScale } from '@/components/pressable-scale';
import { useDataVersion } from '@/db/changes';
import { database } from '@/db/client';
import { readPeriodExpenses, readPeriodRecords, readSettings } from '@/db/records';
import { useToday } from '@/db/use-today';
import { type BigPurchaseSpread, progressChart } from '@/domain/calculations';
import type { IsoDate } from '@/domain/date';
import { carriesBigPurchaseShare, formatDayHeading } from '@/domain/expense';
import { type CurrencyCode, formatMoney, type Minor } from '@/domain/money';
import { inPeriod } from '@/domain/period';

/**
 * Renders the sheet a tap on a day of the chart's last 5 days opens (BR-CHT-04): the day's
 * spending as its bar shows it, the spending so far as its line shows it, and
 * the spending limit by that day, then the day's expenses, newest first. They
 * open to edit, and swipe away to delete, as on the home screen (BR-EXP-06);
 * the numbers follow at once (BR-DSH-04). A day whose bar holds a share of big
 * purchases says so, since the list shows them at their full amount
 * (BR-CALC-05). A day after today, or outside every period, shows no numbers.
 */
export default function DayScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { date } = useLocalSearchParams<{ date: IsoDate }>();
  const today = useToday();
  const version = useDataVersion();

  const data = useMemo(() => {
    const db = database();
    const settings = readSettings(db);
    const records = readPeriodRecords(db, date);
    // The chart as the home screen draws it: up to today, or a past period's last day.
    const chart =
      records &&
      progressChart(
        records,
        inPeriod(records.period, today) ? today : records.period.end,
        (settings?.bigPurchaseSpread ?? 'daysLeft') as BigPurchaseSpread,
      );
    return {
      currency: (settings?.currency ?? 'USD') as CurrencyCode,
      day: chart?.days.find((day) => day.date === date) ?? null,
      expenses: readPeriodExpenses(db, date).filter((expense) => expense.date === date),
    };
    // `version` changes with every write, so the records are read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, today, version]);

  const money = (amount: Minor) => formatMoney(amount, data.currency, i18n.language);
  const { day, expenses } = data;
  const stats =
    day?.spending && day.cumulative
      ? [
          { key: 'spent', label: t('day.spent'), value: day.spending.round() },
          { key: 'soFar', label: t('day.soFar'), value: day.cumulative.round() },
          { key: 'limit', label: t('day.limit'), value: day.limit.round() },
        ]
      : [];
  const shared = !!day?.spending && carriesBigPurchaseShare(day.spending, expenses);

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between px-6 pb-2 pt-6">
        <Text accessibilityRole="header" className="text-3xl font-bold text-black dark:text-white">
          {formatDayHeading(date, today, t, i18n.language)}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('expense.close')}
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900"
        >
          <SymbolView name={{ ios: 'xmark', android: 'close' }} size={16} tintColor="#6B7280" />
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        contentContainerClassName="gap-6 px-6 pt-2"
      >
        {stats.length > 0 && (
          <Animated.View entering={riseIn()} className="gap-3">
            <View className="flex-row gap-3">
              {stats.map((stat) => (
                <View
                  key={stat.key}
                  accessible
                  accessibilityLabel={t('day.stat', {
                    label: stat.label,
                    amount: money(stat.value),
                  })}
                  className="flex-1 gap-1 rounded-3xl bg-gray-100 p-4 dark:bg-gray-900"
                >
                  <Text className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</Text>
                  <CountingText
                    value={stat.value}
                    format={money}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    className="text-xl font-bold text-black dark:text-white"
                  />
                </View>
              ))}
            </View>
            {shared && (
              <Text className="px-1 text-sm text-gray-500 dark:text-gray-400">
                {t('day.bigPurchaseShare')}
              </Text>
            )}
          </Animated.View>
        )}

        {expenses.length > 0 ? (
          <View>
            {expenses.map((expense, index) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                today={today}
                money={money}
                onPress={(id) => router.push(`/expense/${id}`)}
                onDelete={(id) => void deleteExpenseWithUndo(id, t('undo.expenseDeleted'))}
                first={index === 0}
                last={index === expenses.length - 1}
              />
            ))}
          </View>
        ) : (
          <Text className="px-1 text-base text-gray-500 dark:text-gray-400">
            {t('day.noExpenses')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
