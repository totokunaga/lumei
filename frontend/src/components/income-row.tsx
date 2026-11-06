import { SymbolView } from 'expo-symbols';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { ListedIncome } from '@/db/records';
import type { IsoDate } from '@/domain/date';
import { formatExpenseClock, formatExpenseTime } from '@/domain/expense';
import type { Minor } from '@/domain/money';

import { syncMarks } from './expense-row';
import { PressableScale } from './pressable-scale';
import { closeSwipedRow, type SwipeControls, SwipeToDelete } from './swipe-to-delete';

/** Props of `IncomeRow`. */
interface IncomeRowProps {
  income: ListedIncome;
  /** Today's date, which decides "Today" and "Yesterday" (BR-DSH-05). */
  today: IsoDate;
  /** Formats an amount in the account currency, e.g. 3000 as "¥3,000". */
  money: (amount: Minor) => string;
  /** Opens the income to edit or delete it (BR-INC-06). */
  onPress: (id: string) => void;
  /** Deletes the income, offering to undo. */
  onDelete: (id: string) => void;
  /** Rounds the top of its day's card, as the day's first row. */
  first: boolean;
  /** Rounds the bottom of its day's card, as the day's last row. */
  last: boolean;
}

/**
 * Renders one extra income in the home screen's list (BR-DSH-06), under its
 * day's heading, as an expense row does: its description, or "Extra income"
 * without one, the time it arrived, its amount as a green "+¥3,000", and an
 * icon while it isn't synced (BR-OFF-04). Tapping it opens it to edit, and
 * swiping it left deletes it. It reads as one button to screen readers, with
 * a delete action in place of the swipe (BR-NFR-07).
 */
export const IncomeRow = memo(function IncomeRow({
  income,
  today,
  money,
  onPress,
  onDelete,
  first,
  last,
}: IncomeRowProps) {
  const { t, i18n } = useTranslation();
  const name = income.description ?? t('home.extraIncome');
  const amount = t('home.plus', { amount: money(income.amount) });
  const label = t('home.incomeLabel', {
    name,
    amount,
    when: formatExpenseTime(income.receivedAt, today, t, i18n.language),
  });
  const mark = income.sync === 'synced' ? null : syncMarks[income.sync];
  const swipe = useRef<SwipeControls | null>(null);

  return (
    <SwipeToDelete
      rowKey={income.id}
      controlsRef={swipe}
      onDelete={() => onDelete(income.id)}
      className={`bg-gray-100 dark:bg-gray-900 ${first ? 'rounded-t-3xl' : ''} ${
        last ? 'rounded-b-3xl' : ''
      }`}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={mark ? t('home.withSync', { label, status: t(mark.label) }) : label}
        accessibilityHint={t('home.editHint')}
        accessibilityActions={[{ name: 'delete', label: t('income.delete') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') {
            onDelete(income.id);
          }
        }}
        onPress={() => {
          // A tap on an open row, or while another is open, only closes it.
          const open = swipe.current?.isOpen() ?? false;
          if (open) {
            swipe.current?.close();
          }
          if (!closeSwipedRow() && !open) {
            onPress(income.id);
          }
        }}
        className={`flex-row items-center gap-4 px-4 py-3 ${first ? 'pt-4' : ''} ${
          last ? 'pb-4' : ''
        }`}
      >
        <View className="h-11 w-11 items-center justify-center rounded-full bg-white dark:bg-gray-800">
          <Text className="text-xl">💵</Text>
        </View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-base font-semibold text-black dark:text-white">
            {name}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              {formatExpenseClock(income.receivedAt, i18n.language)}
            </Text>
            {mark && <SymbolView name={mark.symbol} size={14} tintColor={mark.color} />}
          </View>
        </View>
        <Text className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
          {amount}
        </Text>
      </PressableScale>
    </SwipeToDelete>
  );
});
