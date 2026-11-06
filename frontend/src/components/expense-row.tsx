import { SymbolView } from 'expo-symbols';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { ListedExpense, SyncState } from '@/db/records';
import type { IsoDate } from '@/domain/date';
import { formatExpenseClock, formatExpenseTime } from '@/domain/expense';
import type { Minor } from '@/domain/money';

import { PressableScale } from './pressable-scale';
import { closeSwipedRow, type SwipeControls, SwipeToDelete } from './swipe-to-delete';

/** Props of `ExpenseRow`. */
interface ExpenseRowProps {
  expense: ListedExpense;
  /** Today's date, which decides "Today" and "Yesterday" (BR-DSH-05). */
  today: IsoDate;
  /** Formats an amount in the account currency, e.g. 1200 as "¥1,200". */
  money: (amount: Minor) => string;
  /** Opens the expense to edit or delete it (BR-EXP-06). */
  onPress: (id: string) => void;
  /** Deletes the expense, offering to undo (BR-EXP-06). */
  onDelete: (id: string) => void;
  /** Rounds the top of its day's card, as the day's first row. */
  first: boolean;
  /** Rounds the bottom of its day's card, as the day's last row. */
  last: boolean;
}

/** The icon and screen-reader text of a record that isn't synced (BR-OFF-04). */
export const syncMarks: Record<
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
 * Renders one expense in the home screen's list (BR-DSH-06), under its
 * day's heading: its category's emoji and name, the time it happened, its amount, a tag for a big purchase
 * (BR-EXP-05), and an icon while it isn't synced (BR-OFF-04). Tapping it
 * opens it to edit, and swiping it left deletes it (BR-EXP-06). It reads as
 * one button to screen readers, with a delete action in place of the swipe
 * (BR-NFR-07). Memoized, since the list re-renders whenever a record changes.
 */
export const ExpenseRow = memo(function ExpenseRow({
  expense,
  today,
  money,
  onPress,
  onDelete,
  first,
  last,
}: ExpenseRowProps) {
  const { t, i18n } = useTranslation();
  const when = formatExpenseTime(expense.spentAt, today, t, i18n.language);
  const amount = money(expense.amount);
  const values = { category: expense.categoryName, amount, when };
  const label = expense.isBigPurchase
    ? t('home.expenseLabelBig', values)
    : t('home.expenseLabel', values);
  const mark = expense.sync === 'synced' ? null : syncMarks[expense.sync];
  const swipe = useRef<SwipeControls | null>(null);

  return (
    <SwipeToDelete
      rowKey={expense.id}
      controlsRef={swipe}
      onDelete={() => onDelete(expense.id)}
      // Each row is a slice of its day's card: the first and last round its corners.
      className={`bg-gray-100 dark:bg-gray-900 ${first ? 'rounded-t-3xl' : ''} ${
        last ? 'rounded-b-3xl' : ''
      }`}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={mark ? t('home.withSync', { label, status: t(mark.label) }) : label}
        accessibilityHint={t('home.editHint')}
        accessibilityActions={[{ name: 'delete', label: t('expense.delete') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') {
            onDelete(expense.id);
          }
        }}
        onPress={() => {
          // A tap on an open row, or while another is open, only closes it.
          const open = swipe.current?.isOpen() ?? false;
          if (open) {
            swipe.current?.close();
          }
          if (!closeSwipedRow() && !open) {
            onPress(expense.id);
          }
        }}
        className={`flex-row items-center gap-4 px-4 py-3 ${first ? 'pt-4' : ''} ${
          last ? 'pb-4' : ''
        }`}
      >
        <View className="h-11 w-11 items-center justify-center rounded-full bg-white dark:bg-gray-800">
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
            {/* The day's heading gives the date; screen readers still hear it with the row. */}
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              {formatExpenseClock(expense.spentAt, i18n.language)}
            </Text>
            {mark && <SymbolView name={mark.symbol} size={14} tintColor={mark.color} />}
          </View>
        </View>
        <Text className="text-base font-semibold text-black dark:text-white">{amount}</Text>
      </PressableScale>
    </SwipeToDelete>
  );
});
