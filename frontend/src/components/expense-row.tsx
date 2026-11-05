import { SymbolView } from 'expo-symbols';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { ListedExpense, SyncState } from '@/db/records';
import type { IsoDate } from '@/domain/date';
import { formatExpenseTime } from '@/domain/expense';
import type { Minor } from '@/domain/money';

/** Props of `ExpenseRow`. */
interface ExpenseRowProps {
  expense: ListedExpense;
  /** Today's date, which decides "Today" and "Yesterday" (BR-DSH-05). */
  today: IsoDate;
  /** Formats an amount in the account currency, e.g. 1200 as "¥1,200". */
  money: (amount: Minor) => string;
}

/** The icon and screen-reader text of an expense that isn't synced (BR-OFF-04). */
const syncMarks: Record<
  Exclude<SyncState, 'synced'>,
  {
    symbol: {
      ios: 'icloud.slash' | 'exclamationmark.icloud';
      android: 'cloud_off' | 'sync_problem';
    };
    color: string;
    label: 'home.notSynced' | 'home.syncFailed';
  }
> = {
  pending: {
    symbol: { ios: 'icloud.slash', android: 'cloud_off' },
    color: '#9CA3AF',
    label: 'home.notSynced',
  },
  failed: {
    symbol: { ios: 'exclamationmark.icloud', android: 'sync_problem' },
    color: '#EF4444',
    label: 'home.syncFailed',
  },
};

/**
 * Renders one expense in the home screen's list (BR-DSH-06): its category's
 * emoji and name, when it happened, its amount, a tag for a big purchase
 * (BR-EXP-05), and an icon while it isn't synced (BR-OFF-04). It reads as
 * one element to screen readers (BR-NFR-07). Memoized, since the list
 * re-renders whenever a record changes.
 */
export const ExpenseRow = memo(function ExpenseRow({ expense, today, money }: ExpenseRowProps) {
  const { t, i18n } = useTranslation();
  const when = formatExpenseTime(expense.spentAt, today, t, i18n.language);
  const amount = money(expense.amount);
  const values = { category: expense.categoryName, amount, when };
  const label = expense.isBigPurchase
    ? t('home.expenseLabelBig', values)
    : t('home.expenseLabel', values);
  const mark = expense.sync === 'synced' ? null : syncMarks[expense.sync];

  return (
    <View
      accessible
      accessibilityLabel={mark ? t('home.withSync', { label, status: t(mark.label) }) : label}
      className="flex-row items-center gap-4 py-3"
    >
      <View className="h-11 w-11 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900">
        <Text className="text-xl">{expense.categoryEmoji}</Text>
      </View>
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text
            numberOfLines={1}
            className="flex-shrink text-base font-semibold text-black dark:text-white"
          >
            {expense.categoryName}
          </Text>
          {expense.isBigPurchase && (
            <View className="rounded-full bg-amber-100 px-2 py-0.5 dark:bg-amber-950">
              <Text className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {t('home.bigPurchase')}
              </Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-sm text-gray-500 dark:text-gray-400">{when}</Text>
          {mark && <SymbolView name={mark.symbol} size={14} tintColor={mark.color} />}
        </View>
      </View>
      <Text className="text-base font-semibold text-black dark:text-white">{amount}</Text>
    </View>
  );
});
