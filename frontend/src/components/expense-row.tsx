import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { ListedExpense } from '@/db/records';
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

/**
 * Renders one expense in the home screen's list (BR-DSH-06): its category's
 * emoji and name, when it happened, its amount, and a tag for a big purchase
 * (BR-EXP-05). It reads as one element to screen readers (BR-NFR-07).
 * Memoized, since the list re-renders whenever a record changes.
 */
export const ExpenseRow = memo(function ExpenseRow({ expense, today, money }: ExpenseRowProps) {
  const { t, i18n } = useTranslation();
  const when = formatExpenseTime(expense.spentAt, today, t, i18n.language);
  const amount = money(expense.amount);
  const values = { category: expense.categoryName, amount, when };

  return (
    <View
      accessible
      accessibilityLabel={
        expense.isBigPurchase ? t('home.expenseLabelBig', values) : t('home.expenseLabel', values)
      }
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
        <Text className="text-sm text-gray-500 dark:text-gray-400">{when}</Text>
      </View>
      <Text className="text-base font-semibold text-black dark:text-white">{amount}</Text>
    </View>
  );
});
