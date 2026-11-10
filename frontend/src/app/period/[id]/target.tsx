import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { z } from 'zod';

import { AmountInput } from '@/components/amount-input';
import { CountingText } from '@/components/counting-text';
import { SetupStep } from '@/components/setup-step';
import { database } from '@/db/client';
import { saveSavingTarget } from '@/db/records';
import { usePeriodItems } from '@/db/use-period-items';
import { spendingBudget } from '@/domain/calculations';
import {
  amountToText,
  type CurrencyCode,
  formatAmountText,
  formatMoney,
  parseAmount,
} from '@/domain/money';
import { formatPeriodRange } from '@/domain/period';
import { ErrorText } from '@/components/error-text';

/**
 * Builds the target's validation: an amount the currency allows, where 0 is
 * allowed (BR-EXP-08), or nothing, which saves 0. The message is a
 * translation key under `setup.errors`.
 * @returns A Zod schema for the form's values.
 */
const formSchema = (currency: CurrencyCode) =>
  z.object({
    amount: z
      .string()
      .refine(
        (text) => !text.trim() || parseAmount(text, currency, { allowZero: true }) !== null,
        'invalidAmount',
      ),
  });

/**
 * Renders the sheet that sets a period's saving target (BR-TGT-01), current
 * or past (BR-HIS-03), with the spending budget it leaves updating as the
 * user types. A target larger than income − fixed expenses gets a warning,
 * but is accepted (BR-TGT-03). Saving updates today's allowance straight
 * away (BR-TGT-02); an empty field saves 0.
 */
export default function PeriodTargetScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, currency } = usePeriodItems(id);
  const schema = useMemo(() => formSchema(currency), [currency]);
  const { control, handleSubmit } = useForm<{ amount: string }>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: items && items.savingTarget > 0 ? amountToText(items.savingTarget, currency) : '',
    },
  });
  const typed = parseAmount(useWatch({ control, name: 'amount' }), currency, { allowZero: true });
  if (!items) {
    return null;
  }
  const budget = spendingBudget({
    period: items.period,
    income: items.incomes.map((item) => item.amount),
    fixedExpenses: items.fixedExpenses.map((item) => item.amount),
    savingTarget: typed ?? 0,
    expenses: [],
  });
  const example = amountToText(123_456, currency);

  return (
    <SetupStep
      title={t('budget.target.title')}
      description={t('budget.forPeriod', {
        range: formatPeriodRange(items.period, t, i18n.language),
      })}
      continueLabel={t('budget.save')}
      onClose={() => router.back()}
      onContinue={() =>
        void handleSubmit(({ amount }) => {
          saveSavingTarget(
            database(),
            id,
            parseAmount(amount, currency, { allowZero: true }) ?? 0,
            Date.now(),
          );
          router.back();
        })()
      }
    >
      <Controller
        control={control}
        name="amount"
        render={({ field: { value, onChange, onBlur }, fieldState }) => (
          <View className="gap-2">
            <AmountInput
              accessibilityLabel={t('budget.target.title')}
              currency={currency}
              locale={i18n.language}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="0"
              invalid={!!fieldState.error}
              autoFocus
            />
            {fieldState.error && (
              <ErrorText className="px-1 text-sm text-red-500">
                {t('setup.errors.invalidAmount', {
                  example: formatAmountText(example, i18n.language),
                })}
              </ErrorText>
            )}
          </View>
        )}
      />

      <View className="gap-2 rounded-3xl bg-gray-50 p-5 dark:bg-gray-950">
        <CountingText
          value={budget}
          format={(amount) =>
            t('setup.target.budget', { amount: formatMoney(amount, currency, i18n.language) })
          }
          className={`text-xl font-bold ${budget < 0 ? 'text-red-500' : 'text-black dark:text-white'}`}
        />
        {budget < 0 && (
          <Animated.View
            entering={FadeIn.reduceMotion(ReduceMotion.System)}
            exiting={FadeOut.reduceMotion(ReduceMotion.System)}
          >
            <ErrorText className="text-base text-red-500">{t('setup.target.overBudget')}</ErrorText>
          </Animated.View>
        )}
      </View>
    </SetupStep>
  );
}
