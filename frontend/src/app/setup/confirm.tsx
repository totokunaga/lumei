import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { CountingText } from '@/components/counting-text';
import { PressableScale } from '@/components/pressable-scale';
import { SetupStep } from '@/components/setup-step';
import { localToday } from '@/domain/date';
import { formatMoney, type Minor } from '@/domain/money';
import { formatPeriodLabel, periodContaining } from '@/domain/period';
import { currentLanguage } from '@/i18n';
import { useDraftBudget } from '@/setup/budget';
import { useSetupDraft } from '@/setup/draft';
import { finishSetup } from '@/setup/finish';
import { editHref, type SetupPath } from '@/setup/navigation';

/**
 * Renders the last setup step: the spending budget the choices give, then a
 * summary of every choice, with a reminder that the currency can't change later
 * (BR-SET-04). The budget counts up from 0 each time the step comes into
 * view, including on coming back from a change. Tapping a choice opens its step to change it, which comes
 * back here when done. Confirming saves everything and opens the home screen
 * (BR-ACC-06).
 */
export default function ConfirmStep() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const draft = useSetupDraft();
  const budget = useDraftBudget();
  const [failed, setFailed] = useState(false);
  // Counts each time the step comes into view, so the budget counts up from 0 again.
  const [views, setViews] = useState(0);
  useFocusEffect(useCallback(() => setViews((n) => n + 1), []));
  const currency = draft.currency ?? 'USD';
  const money = (amount: Minor) => formatMoney(amount, currency, i18n.language);
  const sum = (items: { amount: Minor }[]) => items.reduce((total, item) => total + item.amount, 0);

  // `amount` is set for the rows showing one, which count to a changed amount
  // on coming back from editing it; `value` is what the row says when settled.
  const rows: { label: string; value: string; amount?: Minor; step: SetupPath }[] = [
    {
      label: t('setup.confirm.region'),
      value: draft.set?.name[currentLanguage()] ?? '',
      step: '/setup',
    },
    {
      label: t('setup.confirm.currency'),
      value: t(`currencies.${currency}`),
      step: '/setup/currency',
    },
    {
      step: '/setup/start-day',
      label: t('setup.confirm.period'),
      value: formatPeriodLabel(
        periodContaining(localToday(), draft.periodStartDay),
        t,
        i18n.language,
      ),
    },
    {
      step: '/setup/income',
      label: t('setup.confirm.income'),
      value: draft.incomes.length > 0 ? money(sum(draft.incomes)) : t('setup.confirm.notSet'),
      amount: draft.incomes.length > 0 ? sum(draft.incomes) : undefined,
    },
    {
      step: '/setup/fixed-expenses',
      label: t('setup.confirm.fixedExpenses'),
      value:
        draft.fixedExpenses.length > 0
          ? money(sum(draft.fixedExpenses))
          : t('setup.confirm.notSet'),
      amount: draft.fixedExpenses.length > 0 ? sum(draft.fixedExpenses) : undefined,
    },
    {
      step: '/setup/target',
      label: t('setup.confirm.target'),
      value: draft.savingTarget === null ? t('setup.confirm.notSet') : money(draft.savingTarget),
      amount: draft.savingTarget ?? undefined,
    },
  ];

  return (
    <SetupStep
      title={t('setup.confirm.title')}
      description={t('setup.confirm.description')}
      continueLabel={t('setup.confirm.finish')}
      onContinue={() => {
        try {
          finishSetup();
        } catch {
          setFailed(true);
        }
      }}
      footer={
        <View className="gap-1 pb-1">
          {failed && (
            <Text accessibilityRole="alert" className="text-center text-sm text-red-500">
              {t('setup.confirm.failed')}
            </Text>
          )}
          <Text className="text-center text-sm font-medium text-amber-600 dark:text-amber-400">
            {t('setup.currency.notice')}
          </Text>
        </View>
      }
    >
      <View className="items-center gap-1 rounded-3xl bg-emerald-50 p-6 dark:bg-emerald-950">
        <Text className="text-sm font-medium uppercase text-emerald-700 dark:text-emerald-300">
          {t('setup.confirm.budget')}
        </Text>
        <CountingText
          value={budget}
          format={money}
          from={0}
          restart={views}
          duration={800}
          className={`text-5xl font-bold ${
            budget < 0 ? 'text-red-500' : 'text-emerald-700 dark:text-emerald-300'
          }`}
        />
      </View>

      <View className="overflow-hidden rounded-3xl bg-gray-50 dark:bg-gray-950">
        {rows.map((row, index) => (
          <PressableScale
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={t('setup.confirm.edit', { item: row.label, value: row.value })}
            onPress={() => router.push(editHref(row.step))}
            className={`flex-row items-center justify-between gap-4 px-5 py-4 ${
              index > 0 ? 'border-t border-gray-200 dark:border-gray-800' : ''
            }`}
          >
            <Text className="text-base text-gray-500 dark:text-gray-400">{row.label}</Text>
            <View className="flex-shrink flex-row items-center gap-2">
              {row.amount === undefined ? (
                <Text className="flex-shrink text-right text-base font-semibold text-black dark:text-white">
                  {row.value}
                </Text>
              ) : (
                <CountingText
                  value={row.amount}
                  format={money}
                  className="flex-shrink text-right text-base font-semibold text-black dark:text-white"
                />
              )}
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right' }}
                size={14}
                tintColor="#9CA3AF"
              />
            </View>
          </PressableScale>
        ))}
      </View>
    </SetupStep>
  );
}
