import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { database } from '@/db/client';
import { newId } from '@/db/ids';
import {
  addExpense,
  readCategories,
  readCategory,
  readFirstPeriodStart,
  readPeriodRecords,
  readSettings,
  type StoredExpense,
  updateExpense,
} from '@/db/records';
import { todayStatus } from '@/domain/calculations';
import { localToday } from '@/domain/date';
import { clampSpentAt, isOverToday } from '@/domain/expense';
import { amountToText, type CurrencyCode, parseAmount } from '@/domain/money';

import { AmountInput } from './amount-input';
import { DateTimeField } from './date-time-field';
import { deleteExpenseWithUndo } from './delete-expense';
import { PressableScale } from './pressable-scale';
import { TextField } from './text-field';

/** The form as typed: the amount stays text until it is saved. */
interface Values {
  amount: string;
  categoryId: string;
  isBigPurchase: boolean;
  /** When it happened, in milliseconds since the epoch. */
  spentAt: number;
  description: string;
}

/**
 * Builds the form's validation: an amount greater than 0 with the decimals
 * the currency allows (BR-EXP-08), and a category (BR-EXP-01).
 * @returns A Zod schema for the form's values.
 */
const formSchema = (currency: CurrencyCode) =>
  z.object({
    amount: z.string().refine((text) => parseAmount(text, currency) !== null),
    categoryId: z.string().min(1),
    isBigPurchase: z.boolean(),
    spentAt: z.number(),
    description: z.string(),
  });

/** Props of `ExpenseForm`. */
interface ExpenseFormProps {
  /** The expense to edit; omitted to record a new one. */
  expense?: StoredExpense;
}

/**
 * Renders the form that records an expense (BR-EXP-01 to BR-EXP-05), or
 * edits one when given `expense` (BR-EXP-06). A new one opens with the amount
 * focused, so recording takes three taps from the home screen: the add
 * button, a category, and save (BR-EXP-09). The date and time start at now
 * and can move back, but not later than now nor before the first period
 * (BR-EXP-02); a new date can move an edited expense to another period
 * (BR-EXP-07). Saving writes to the device first (BR-OFF-01), with a success
 * haptic, or a gentler warning one when it leaves today over its allowance,
 * and closes the sheet. Deleting an edited expense closes the sheet and
 * offers to undo for a few seconds.
 */
export function ExpenseForm({ expense }: ExpenseFormProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [failed, setFailed] = useState(false);

  // Read once: the sheet records into the categories and period as they were when it opened.
  const { currency, categories, earliest } = useMemo(() => {
    const db = database();
    const active = readCategories(db);
    // An expense in an archived category keeps it (BR-CAT-03), so it is offered too.
    const kept =
      expense && !active.some((c) => c.id === expense.categoryId)
        ? readCategory(db, expense.categoryId)
        : null;
    return {
      currency: (readSettings(db)?.currency ?? 'USD') as CurrencyCode,
      categories: kept ? [kept, ...active] : active,
      earliest: readFirstPeriodStart(db) ?? localToday(),
    };
    // Read once, as the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [openedAt] = useState(Date.now);
  const schema = useMemo(() => formSchema(currency), [currency]);
  const { control, handleSubmit, setValue } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: expense
      ? {
          amount: amountToText(expense.amount, currency),
          categoryId: expense.categoryId,
          isBigPurchase: expense.isBigPurchase,
          spentAt: expense.spentAt,
          description: expense.description ?? '',
        }
      : { amount: '', categoryId: '', isBigPurchase: false, spentAt: openedAt, description: '' },
  });
  const [amount, categoryId] = useWatch({ control, name: ['amount', 'categoryId'] });
  const valid = parseAmount(amount, currency) !== null && categoryId !== '';
  const invalidAmount = amount.trim() !== '' && parseAmount(amount, currency) === null;
  const [y, m, d] = earliest.split('-').map(Number);

  /** Saves the expense, plays the haptic for where it leaves today, and closes the sheet. */
  const save = (values: Values) => {
    const db = database();
    const now = Date.now();
    const saved = {
      amount: parseAmount(values.amount, currency)!,
      categoryId: values.categoryId,
      spentAt: clampSpentAt(values.spentAt, now, earliest),
      isBigPurchase: values.isBigPurchase,
      description: values.description.trim() || null,
    };
    try {
      if (expense) {
        updateExpense(db, expense.id, saved, now);
      } else {
        addExpense(db, saved, newId(), now);
      }
    } catch {
      setFailed(true);
      return;
    }
    const today = localToday();
    const records = readPeriodRecords(db, today);
    const over = records !== null && isOverToday(todayStatus(records, today));
    void Haptics.notificationAsync(
      over ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
    );
    router.back();
  };

  /** Deletes the edited expense, closes the sheet, and offers to undo (BR-EXP-06). */
  const remove = () => {
    if (!expense) {
      return;
    }
    if (!deleteExpenseWithUndo(expense.id, t('undo.expenseDeleted'))) {
      setFailed(true);
      return;
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between px-6 pb-2 pt-6">
        <Text accessibilityRole="header" className="text-3xl font-bold text-black dark:text-white">
          {expense ? t('expense.editTitle') : t('expense.title')}
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
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-6 px-6 pb-6 pt-2"
      >
        <View className="gap-2">
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <AmountInput
                currency={currency}
                locale={i18n.language}
                value={field.value}
                onChangeText={field.onChange}
                invalid={invalidAmount}
                autoFocus={!expense}
                accessibilityLabel={t('expense.amount')}
                placeholder="0"
              />
            )}
          />
          {invalidAmount && (
            <Text accessibilityRole="alert" className="text-sm text-red-500">
              {t('expense.invalidAmount')}
            </Text>
          )}
        </View>

        <View className="gap-3">
          <Text className="text-sm font-medium uppercase text-gray-500 dark:text-gray-400">
            {t('expense.category')}
          </Text>
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
            {categories.map((category) => {
              const selected = category.id === categoryId;
              return (
                <PressableScale
                  key={category.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setValue('categoryId', category.id)}
                  className={`flex-row items-center gap-2 rounded-2xl px-4 py-3 ${
                    selected ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-900'
                  }`}
                >
                  <Text className="text-lg">{category.emoji}</Text>
                  <Text
                    className={`text-base font-medium ${
                      selected ? 'text-white' : 'text-black dark:text-white'
                    }`}
                  >
                    {category.name}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <TextField
              accessibilityLabel={t('expense.description')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('expense.description')}
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
              className="min-h-14 rounded-2xl bg-gray-100 px-4 py-4 text-black dark:bg-gray-900 dark:text-white"
            />
          )}
        />

        <View className="overflow-hidden rounded-3xl bg-gray-50 dark:bg-gray-950">
          <View className="flex-row items-center justify-between gap-4 px-5 py-4">
            <View className="flex-shrink gap-1">
              <Text className="text-base font-medium text-black dark:text-white">
                {t('expense.bigPurchase')}
              </Text>
              <Text className="text-sm text-gray-500 dark:text-gray-400">
                {t('expense.bigPurchaseHint')}
              </Text>
            </View>
            <Controller
              control={control}
              name="isBigPurchase"
              render={({ field }) => (
                <Switch
                  accessibilityLabel={t('expense.bigPurchase')}
                  value={field.value}
                  onValueChange={field.onChange}
                  trackColor={{ true: '#10B981' }}
                />
              )}
            />
          </View>
          <View className="flex-row items-center justify-between gap-4 border-t border-gray-200 px-5 py-3 dark:border-gray-800">
            <Text className="text-base font-medium text-black dark:text-white">
              {t('expense.when')}
            </Text>
            <Controller
              control={control}
              name="spentAt"
              render={({ field }) => (
                <DateTimeField
                  label={t('expense.when')}
                  value={field.value}
                  onChange={(value) => field.onChange(clampSpentAt(value, Date.now(), earliest))}
                  min={new Date(y, m - 1, d)}
                  max={new Date()}
                />
              )}
            />
          </View>
        </View>
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + 12 }} className="gap-2 px-6 pt-3">
        {failed && (
          <Text accessibilityRole="alert" className="text-center text-sm text-red-500">
            {t('expense.failed')}
          </Text>
        )}
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid }}
          disabled={!valid}
          onPress={() => void handleSubmit(save)()}
          className={`h-14 items-center justify-center rounded-2xl ${
            valid ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-800'
          }`}
        >
          <Text
            className={`text-lg font-semibold ${
              valid ? 'text-white' : 'text-gray-400 dark:text-gray-600'
            }`}
          >
            {t('expense.save')}
          </Text>
        </PressableScale>
        {expense && (
          <PressableScale
            accessibilityRole="button"
            onPress={remove}
            className="h-12 items-center justify-center"
          >
            <Text className="text-base font-semibold text-red-600 dark:text-red-400">
              {t('expense.delete')}
            </Text>
          </PressableScale>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
