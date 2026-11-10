import { zodResolver } from '@hookform/resolvers/zod';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { database } from '@/db/client';
import { newId } from '@/db/ids';
import {
  addExtraIncome,
  readFirstPeriodStart,
  readSettings,
  type StoredExtraIncome,
  updateExtraIncome,
} from '@/db/records';
import { localToday } from '@/domain/date';
import { clampSpentAt } from '@/domain/expense';
import { amountToText, type CurrencyCode, parseAmount } from '@/domain/money';
import { ErrorText } from './error-text';

import { AmountInput } from './amount-input';
import { DateTimeField } from './date-time-field';
import { deleteIncomeWithUndo } from './delete-expense';
import { PressableScale } from './pressable-scale';
import { TextField } from './text-field';

/** The form as typed: the amount stays text until it is saved. */
interface Values {
  amount: string;
  description: string;
  /** When it arrived, in milliseconds since the epoch. */
  receivedAt: number;
}

/**
 * Builds the form's validation: an amount greater than 0 with the decimals
 * the currency allows (BR-EXP-08).
 * @returns A Zod schema for the form's values.
 */
const formSchema = (currency: CurrencyCode) =>
  z.object({
    amount: z.string().refine((text) => parseAmount(text, currency) !== null),
    description: z.string(),
    receivedAt: z.number(),
  });

/** Props of `IncomeForm`. */
interface IncomeFormProps {
  /** The extra income to edit; omitted to record new one. */
  income?: StoredExtraIncome;
}

/**
 * Renders the form that records extra income (BR-INC-06), or edits it when
 * given `income`: an amount, an optional description, and when it arrived,
 * which starts at now and can move back, but not later than now nor before
 * the first period, as for an expense (BR-EXP-02). New income opens with the
 * amount focused. Saving writes to the device first, with a success haptic,
 * and raises today's allowance straight away (BR-CALC-02). Deleting closes
 * the sheet and offers to undo for a few seconds.
 */
export function IncomeForm({ income }: IncomeFormProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [failed, setFailed] = useState(false);

  const { currency, earliest } = useMemo(() => {
    const db = database();
    return {
      currency: (readSettings(db)?.currency ?? 'USD') as CurrencyCode,
      earliest: readFirstPeriodStart(db) ?? localToday(),
    };
  }, []);
  const [openedAt] = useState(Date.now);
  const schema = useMemo(() => formSchema(currency), [currency]);
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: income
      ? {
          amount: amountToText(income.amount, currency),
          description: income.description ?? '',
          receivedAt: income.receivedAt,
        }
      : { amount: '', description: '', receivedAt: openedAt },
  });
  const amount = useWatch({ control, name: 'amount' });
  const valid = parseAmount(amount, currency) !== null;
  const invalidAmount = amount.trim() !== '' && !valid;
  const [y, m, d] = earliest.split('-').map(Number);

  /** Saves the income, with a success haptic, and closes the sheet. */
  const save = (values: Values) => {
    const db = database();
    const now = Date.now();
    const saved = {
      amount: parseAmount(values.amount, currency)!,
      receivedAt: clampSpentAt(values.receivedAt, now, earliest),
      description: values.description.trim() || null,
    };
    try {
      if (income) {
        updateExtraIncome(db, income.id, saved, now);
      } else {
        addExtraIncome(db, saved, newId(), now);
      }
    } catch {
      setFailed(true);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  /** Deletes the edited income, closes the sheet, and offers to undo. */
  const remove = () => {
    if (!income) {
      return;
    }
    if (!deleteIncomeWithUndo(income.id, t('undo.incomeDeleted'))) {
      setFailed(true);
      return;
    }
    router.back();
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between px-6 pb-2 pt-6">
        <Text accessibilityRole="header" className="text-3xl font-bold text-black dark:text-white">
          {income ? t('income.editTitle') : t('income.title')}
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
                autoFocus={!income}
                accessibilityLabel={t('expense.amount')}
                placeholder="0"
              />
            )}
          />
          {invalidAmount && (
            <ErrorText className="text-sm text-red-500">{t('expense.invalidAmount')}</ErrorText>
          )}
        </View>

        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <TextField
              accessibilityLabel={t('income.description')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={t('income.descriptionPlaceholder')}
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={500}
              className="min-h-14 rounded-2xl bg-gray-100 px-4 py-4 text-black dark:bg-gray-900 dark:text-white"
            />
          )}
        />

        <View className="flex-row items-center justify-between gap-4 rounded-3xl bg-gray-50 px-5 py-3 dark:bg-gray-950">
          <Text className="text-base font-medium text-black dark:text-white">
            {t('expense.when')}
          </Text>
          <Controller
            control={control}
            name="receivedAt"
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
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + 12 }} className="gap-2 px-6 pt-3">
        {failed && (
          <ErrorText className="text-center text-sm text-red-500">{t('income.failed')}</ErrorText>
        )}
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid }}
          disabled={!valid}
          onPress={() => void handleSubmit(save)()}
          className={`min-h-14 items-center justify-center rounded-2xl ${
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
        {income && (
          <PressableScale
            accessibilityRole="button"
            onPress={remove}
            className="min-h-12 items-center justify-center"
          >
            <Text className="text-base font-semibold text-red-600 dark:text-red-400">
              {t('income.delete')}
            </Text>
          </PressableScale>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
