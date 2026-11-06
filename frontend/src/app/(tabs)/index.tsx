import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteExpenseWithUndo, deleteIncomeWithUndo } from '@/components/delete-expense';
import { ExpenseRow } from '@/components/expense-row';
import { FloatingToggle } from '@/components/floating-toggle';
import { IncomeRow } from '@/components/income-row';
import { PressableScale } from '@/components/pressable-scale';
import { ProgressChart } from '@/components/progress-chart';
import { QuickAddButton } from '@/components/quick-add-button';
import { ResultCard } from '@/components/result-card';

import type { EditableItem } from '@/components/summary-rows';
import { TodayCard } from '@/components/today-card';
import { useDataVersion } from '@/db/changes';
import { database } from '@/db/client';
import {
  type ListedExpense,
  type ListedIncome,
  readNeighbourPeriods,
  readPeriodExpenses,
  readPeriodExtraIncome,
  readPeriodItems,
  readPeriodOn,
  readPeriodRecords,
  readSettings,
} from '@/db/records';
import { useToday } from '@/db/use-today';
import {
  type BigPurchaseSpread,
  periodResult,
  periodSummary,
  progressChart,
  todayStatus,
} from '@/domain/calculations';
import type { IsoDate } from '@/domain/date';
import { formatDayHeading, groupByDay } from '@/domain/expense';
import { type CurrencyCode, formatMoney, type Minor } from '@/domain/money';
import { formatPeriodName, inPeriod } from '@/domain/period';
import { TAB_BAR_CLEARANCE } from '@/lib/layout';

/**
 * Renders the home screen, the Home tab. Its title names the period shown
 * (BR-PER-06), with arrows to the previous and next periods where there are
 * any (BR-HIS-01). For the current period: today's numbers (BR-DSH-01,
 * BR-DSH-02) in a card that expands to the period summary (BR-DSH-03), and
 * the button that records an expense (BR-EXP-09). For a past period: its
 * result (BR-HIS-02) as it stood at its end, editable (BR-HIS-03). Under
 * either, the period's expenses by day, newest first, each day with its
 * total (BR-DSH-06). Every number is worked out on the device from the
 * account's records (BR-OFF-02), and updates as soon as a record changes
 * (BR-DSH-04, BR-NFR-04) and at local midnight (BR-DSH-05).
 */
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const version = useDataVersion();
  // A day of the period shown; null for the current one, which follows today.
  const [shownDay, setShownDay] = useState<IsoDate | null>(null);
  // Which list shows under the card; expenses first (BR-DSH-06).
  const [list, setList] = useState<'expenses' | 'income'>('expenses');
  const day = shownDay ?? today;

  const data = useMemo(() => {
    const db = database();
    const period = readPeriodOn(db, day);
    const records = readPeriodRecords(db, day);
    const current = period !== null && inPeriod(period, today);
    const settings = readSettings(db);
    return {
      currency: (settings?.currency ?? 'USD') as CurrencyCode,
      period,
      current,
      neighbours: period ? readNeighbourPeriods(db, period) : { previous: null, next: null },
      records,
      expenses: readPeriodExpenses(db, day),
      extraIncome: readPeriodExtraIncome(db, day),
      plannedIncome: period ? (readPeriodItems(db, period.id)?.incomes ?? []) : [],
      status: records && current ? todayStatus(records, today) : null,
      // A past period's totals as they stood at its end (BR-HIS-01).
      summary: records && periodSummary(records, current ? today : records.period.end),
      result: records && !current ? periodResult(records) : null,
      // A past period's chart as it stood at its end (BR-HIS-01).
      chart:
        records &&
        progressChart(
          records,
          current ? today : records.period.end,
          (settings?.bigPurchaseSpread ?? 'daysLeft') as BigPurchaseSpread,
        ),
    };
    // `version` changes with every write, so the records are read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, today, version]);

  /** Shows a period, or the current one, which then follows today again. */
  const show = (period: { start: IsoDate; end: IsoDate } | null) =>
    setShownDay(period && !inPeriod(period, today) ? period.start : null);
  const edit = (item: EditableItem) =>
    data.period && router.push(`/period/${data.period.id}/${item}`);
  const money = (amount: Minor) => formatMoney(amount, data.currency, i18n.language);
  // Each day's heading, then its expenses or extra income, newest first
  // (BR-DSH-06); the income list starts with the planned income.
  const items = useMemo((): ListItem[] => {
    if (list === 'expenses') {
      return groupByDay(data.expenses).flatMap((day): ListItem[] => [
        { kind: 'day', date: day.date, total: day.total, income: false },
        ...day.expenses.map((expense, index): ListItem => ({
          kind: 'expense',
          expense,
          first: index === 0,
          last: index === day.expenses.length - 1,
        })),
      ]);
    }
    const days = groupByDay(data.extraIncome).flatMap((day): ListItem[] => [
      { kind: 'day', date: day.date, total: day.total, income: true },
      ...day.expenses.map((income, index): ListItem => ({
        kind: 'income',
        income,
        first: index === 0,
        last: index === day.expenses.length - 1,
      })),
    ]);
    return [{ kind: 'planned' }, ...(days.length > 0 ? days : [{ kind: 'noExtra' } as const])];
  }, [list, data.expenses, data.extraIncome]);
  const openExpense = useCallback((id: string) => router.push(`/expense/${id}`), [router]);
  const removeExpense = useCallback(
    (id: string) => void deleteExpenseWithUndo(id, t('undo.expenseDeleted')),
    [t],
  );
  const openIncome = useCallback((id: string) => router.push(`/income/${id}`), [router]);
  const removeIncome = useCallback(
    (id: string) => void deleteIncomeWithUndo(id, t('undo.incomeDeleted')),
    [t],
  );

  const header = (
    <View className="gap-6 pb-3">
      <View className="flex-row items-center justify-between gap-2">
        <PeriodArrow
          direction="previous"
          label={t('home.previousPeriod')}
          onPress={data.neighbours.previous && (() => show(data.neighbours.previous))}
        />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          className="flex-shrink text-center text-xl font-semibold text-black dark:text-white"
        >
          {data.period ? formatPeriodName(data.period, i18n.language) : t('home.today')}
        </Text>
        <PeriodArrow
          direction="next"
          label={t('home.nextPeriod')}
          onPress={data.neighbours.next && (() => show(data.neighbours.next))}
        />
      </View>

      {data.records && data.summary ? (
        <>
          {data.status ? (
            <TodayCard status={data.status} summary={data.summary} money={money} onEdit={edit} />
          ) : (
            data.result && (
              <ResultCard result={data.result} summary={data.summary} money={money} onEdit={edit} />
            )
          )}
          {data.chart && <ProgressChart chart={data.chart} money={money} ended={!data.current} />}
          <View className="pt-2">
            <FloatingToggle
              label={t('home.show')}
              options={[
                { value: 'expenses', label: t('home.expenses') },
                { value: 'income', label: t('home.incomeTab') },
              ]}
              value={list}
              onChange={setList}
            />
          </View>
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
        data={items}
        keyExtractor={(item) => {
          switch (item.kind) {
            case 'day':
              return `day-${item.income ? 'income' : 'expense'}-${item.date}`;
            case 'expense':
              return item.expense.id;
            case 'income':
              return item.income.id;
            default:
              return item.kind;
          }
        }}
        getItemType={(item) => item.kind}
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'day':
              return (
                <DayHeading
                  label={formatDayHeading(item.date, today, t, i18n.language)}
                  total={
                    item.income ? t('home.plus', { amount: money(item.total) }) : money(item.total)
                  }
                />
              );
            case 'expense':
              return (
                <ExpenseRow
                  expense={item.expense}
                  today={today}
                  money={money}
                  onPress={openExpense}
                  onDelete={removeExpense}
                  first={item.first}
                  last={item.last}
                />
              );
            case 'income':
              return (
                <IncomeRow
                  income={item.income}
                  today={today}
                  money={money}
                  onPress={openIncome}
                  onDelete={removeIncome}
                  first={item.first}
                  last={item.last}
                />
              );
            case 'planned':
              return (
                <PlannedIncome
                  items={data.plannedIncome}
                  money={money}
                  onPress={() => edit('income')}
                />
              );
            case 'noExtra':
              return (
                <Text className="px-1 pt-7 text-base text-gray-500 dark:text-gray-400">
                  {t('home.noExtraIncome')}
                </Text>
              );
          }
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          data.records ? (
            <Text className="px-1 py-3 text-base text-gray-500 dark:text-gray-400">
              {data.current ? t('home.noExpenses') : t('home.noExpensesInPeriod')}
            </Text>
          ) : null
        }
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 88,
          paddingHorizontal: 24,
        }}
      />

      {/* Records are added to today, so only the current period offers it; it adds what the list shows. */}
      {data.records && data.current && (
        <View
          pointerEvents="box-none"
          style={{ bottom: insets.bottom + TAB_BAR_CLEARANCE + 16 }}
          className="absolute right-6"
        >
          <QuickAddButton
            label={list === 'income' ? t('home.addIncome') : t('home.addExpense')}
            onPress={() => router.push(list === 'income' ? '/income/new' : '/expense/new')}
          />
        </View>
      )}
    </View>
  );
}

/**
 * Renders an arrow beside the title that shows the previous or next period
 * (BR-HIS-01). Without a period that way, it keeps its space, so the title
 * stays centered, but shows nothing.
 */
function PeriodArrow({
  direction,
  label,
  onPress,
}: {
  direction: 'previous' | 'next';
  label: string;
  onPress: (() => void) | null;
}) {
  if (!onPress) {
    return <View className="h-9 w-9" />;
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // Smaller than the title row's 44pt touch target, so the hit area makes up the rest.
      hitSlop={4}
      className="h-9 w-9 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900"
    >
      <SymbolView
        name={
          direction === 'previous'
            ? { ios: 'chevron.left', android: 'chevron_left' }
            : { ios: 'chevron.right', android: 'chevron_right' }
        }
        size={14}
        weight="semibold"
        tintColor="#6B7280"
      />
    </PressableScale>
  );
}

/** An entry of the home screen's list: a day's heading, or one of its expenses. */
type ListItem =
  | { kind: 'day'; date: IsoDate; total: Minor; income: boolean }
  | { kind: 'expense'; expense: ListedExpense; first: boolean; last: boolean }
  | { kind: 'income'; income: ListedIncome; first: boolean; last: boolean }
  | { kind: 'planned' }
  | { kind: 'noExtra' };

/**
 * Renders the period's planned income at the top of the income list
 * (BR-DSH-06): a heading with its total, and one card listing the items,
 * which opens the planned income editor (BR-INC-01). Without items, the card
 * offers to add some.
 */
function PlannedIncome({
  items,
  money,
  onPress,
}: {
  items: { id: string; name: string; amount: Minor }[];
  money: (amount: Minor) => string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <View>
      <DayHeading label={t('home.planned')} total={money(total)} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          items.length > 0
            ? items.map((item) => `${item.name}, ${money(item.amount)}`).join('; ')
            : t('home.addPlannedIncome')
        }
        accessibilityHint={t('home.editHint')}
        onPress={onPress}
        className="gap-3 rounded-3xl bg-gray-100 px-4 py-4 dark:bg-gray-900"
      >
        {items.length > 0 ? (
          items.map((item) => (
            <View key={item.id} className="flex-row items-center justify-between gap-4">
              <Text
                numberOfLines={1}
                className="flex-shrink text-base font-semibold text-black dark:text-white"
              >
                {item.name}
              </Text>
              <Text className="text-base font-semibold text-black dark:text-white">
                {money(item.amount)}
              </Text>
            </View>
          ))
        ) : (
          <Text className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
            {t('home.addPlannedIncome')}
          </Text>
        )}
      </PressableScale>
    </View>
  );
}

/**
 * Renders a day's heading in the list, with the total of its expenses on the
 * right, lined up with the amounts in its card, e.g. "Yesterday   ¥2,000". It reads as one heading to screen
 * readers, e.g. "Yesterday: ¥2,000 in total".
 */
function DayHeading({ label, total }: { label: string; total: string }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={t('home.dayTotal', { day: label, amount: total })}
      className="flex-row items-baseline justify-between gap-4 pb-3 pl-1 pr-4 pt-7"
    >
      <Text className="text-xl font-bold text-black dark:text-white">{label}</Text>
      <Text className="text-base font-semibold text-gray-500 dark:text-gray-400">{total}</Text>
    </View>
  );
}
