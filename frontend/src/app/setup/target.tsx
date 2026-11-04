import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { z } from 'zod';

import { AmountInput } from '@/components/amount-input';
import { CountingText } from '@/components/counting-text';
import { SetupStep } from '@/components/setup-step';
import {
  amountToText,
  type CurrencyCode,
  formatAmountText,
  formatMoney,
  parseAmount,
} from '@/domain/money';
import { useDraftBudget } from '@/setup/budget';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';

/**
 * Builds the target's validation: an amount the currency allows, where 0 is
 * allowed (BR-EXP-08), or nothing, which leaves the target unset. The message
 * is a translation key under `setup.errors`.
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
 * Renders the saving target step (BR-TGT-01): the amount the user wants left
 * at the end of each period, with the spending budget it leaves updating as
 * they type. A target larger than income − fixed expenses gets a warning, but
 * is accepted (BR-TGT-03). Skipping, or continuing with the field empty,
 * leaves the target unset.
 */
export default function TargetStep() {
  const { t, i18n } = useTranslation();
  const flow = useSetupFlow();
  const currency = useSetupDraft((s) => s.currency) ?? 'USD';
  const chosen = useSetupDraft((s) => s.savingTarget);
  const setSavingTarget = useSetupDraft((s) => s.setSavingTarget);
  const schema = useMemo(() => formSchema(currency), [currency]);
  const { control, handleSubmit } = useForm<{ amount: string }>({
    resolver: zodResolver(schema),
    defaultValues: { amount: chosen === null ? '' : amountToText(chosen, currency) },
  });
  const typed = parseAmount(useWatch({ control, name: 'amount' }), currency, { allowZero: true });
  const budget = useDraftBudget(typed ?? 0);
  const example = amountToText(123_456, currency);
  const exampleText = formatAmountText(example, i18n.language);

  /** Saves the target, or clears it when skipped, and goes to the last step. */
  const next = (amount: number | null) => {
    setSavingTarget(amount);
    flow.next('/setup/confirm');
  };

  return (
    <SetupStep
      step="target"
      title={t('setup.target.title')}
      description={t('setup.target.description')}
      onContinue={() =>
        void handleSubmit(({ amount }) =>
          next(parseAmount(amount, currency, { allowZero: true })),
        )()
      }
      onSkip={() => next(null)}
      editing={flow.editing}
    >
      <Controller
        control={control}
        name="amount"
        render={({ field: { value, onChange, onBlur }, fieldState }) => (
          <View className="gap-2">
            <AmountInput
              accessibilityLabel={t('setup.target.title')}
              currency={currency}
              locale={i18n.language}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder={example}
              invalid={!!fieldState.error}
              autoFocus
            />
            {fieldState.error && (
              <Text accessibilityRole="alert" className="px-1 text-sm text-red-500">
                {t('setup.errors.invalidAmount', { example: exampleText })}
              </Text>
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
          className={`text-xl font-bold ${
            budget < 0 ? 'text-red-500' : 'text-black dark:text-white'
          }`}
        />
        {budget < 0 && (
          <Animated.Text
            entering={FadeIn.reduceMotion(ReduceMotion.System)}
            exiting={FadeOut.reduceMotion(ReduceMotion.System)}
            accessibilityRole="alert"
            className="text-base text-red-500"
          >
            {t('setup.target.overBudget')}
          </Animated.Text>
        )}
      </View>
    </SetupStep>
  );
}
