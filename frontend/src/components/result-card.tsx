import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { PeriodResult, PeriodSummary } from '@/domain/calculations';
import type { Minor } from '@/domain/money';

import { CountingText } from './counting-text';
import { type EditableItem, type SummaryRow, SummaryRows } from './summary-rows';

/** Props of `ResultCard`. */
interface ResultCardProps {
  result: PeriodResult;
  /** The period's totals as they stood at its end. */
  summary: PeriodSummary;
  /** Formats an amount in the account currency, e.g. 4865 as "¥4,865". */
  money: (amount: Minor) => string;
  /** Opens the editor of the period's income, fixed expenses, or saving target (BR-HIS-03). */
  onEdit: (item: EditableItem) => void;
}

/**
 * Renders a past period's result (BR-HIS-02): the amount saved as the hero
 * (BR-CALC-07), negative when income was overspent, and whether it met the
 * saving target, in green when it did and red when it didn't. Under it, the
 * period's totals; income, fixed expenses, and the target open their editor,
 * so a late change recalculates the result (BR-HIS-03). Each number reads as
 * one element to screen readers (BR-NFR-07).
 */
export function ResultCard({ result, summary, money, onEdit }: ResultCardProps) {
  const { t } = useTranslation();
  const met = result.targetMet;
  const accent = met ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400';
  const verdict = met
    ? t('home.targetMet', { target: money(summary.savingTarget) })
    : t('home.targetMissed', {
        short: money(summary.savingTarget - result.saved),
        target: money(summary.savingTarget),
      });

  const rows: SummaryRow[] = [
    { label: t('home.income'), value: summary.income, format: money, edit: 'income' },
    { label: t('home.extraIncome'), value: summary.extraIncome, format: money },
    {
      label: t('home.fixedExpenses'),
      value: summary.fixedExpenses,
      format: money,
      edit: 'fixed-expenses',
    },
    { label: t('home.savingTarget'), value: summary.savingTarget, format: money, edit: 'target' },
    { label: t('home.bigPurchases'), value: summary.bigPurchases, format: money },
    { label: t('home.spent'), value: summary.spentToDate, format: money },
  ];

  return (
    <View
      className={`gap-3 rounded-3xl p-6 ${
        met ? 'bg-emerald-50 dark:bg-emerald-950' : 'bg-red-50 dark:bg-red-950'
      }`}
    >
      <View
        accessible
        accessibilityLabel={`${t('home.labelled', {
          label: t('home.saved'),
          value: money(result.saved),
        })}, ${verdict}`}
        className="gap-1"
      >
        <Text className={`text-sm font-medium uppercase ${accent}`}>{t('home.saved')}</Text>
        <CountingText
          value={result.saved}
          format={money}
          adjustsFontSizeToFit
          numberOfLines={1}
          className={`text-6xl font-bold ${accent}`}
        />
        <View className="flex-row items-center gap-1.5">
          <SymbolView
            name={
              met
                ? { ios: 'checkmark.circle.fill', android: 'check_circle' }
                : { ios: 'xmark.circle.fill', android: 'cancel' }
            }
            size={16}
            tintColor={met ? '#059669' : '#DC2626'}
          />
          <Text className="flex-shrink text-base text-gray-700 dark:text-gray-300">{verdict}</Text>
        </View>
      </View>
      <View>
        <SummaryRows rows={rows} onEdit={onEdit} />
      </View>
    </View>
  );
}
