import { useTranslation } from 'react-i18next';

import type { PeriodSummary, TodayStatus, WeekStatus } from '@/domain/calculations';
import { allowanceUse, todayUse } from '@/domain/expense';
import type { Minor } from '@/domain/money';
import type { Period } from '@/domain/period';

import { StatusCard } from './status-card';
import { type EditableItem, type SummaryRow, SummaryRows } from './summary-rows';

/** Formats an amount in the account currency, e.g. 4865 as "¥4,865". */
type Money = (amount: Minor) => string;

/**
 * Renders today's numbers (BR-DSH-01, BR-DSH-02): remaining today as the hero, and today's spending against the daily
 * allowance as amounts and a ring. While the whole period is overspent, the
 * allowance shows 0 and the period's overspend becomes the hero, as a
 * negative amount under "Over for this period". The card is green below 65%
 * of the allowance, amber from 65%, and red from 80% (BR-DSH-01).
 */
export function TodayCard({ status, money }: { status: TodayStatus; money: Money }) {
  const { t } = useTranslation();
  const periodOver = status.periodOverspend > 0;
  return (
    <StatusCard
      hero={
        periodOver
          ? { label: t('home.periodOver'), value: -status.periodOverspend }
          : { label: t('home.remainingToday'), value: status.remainingToday ?? 0 }
      }
      heroKey={periodOver ? 'periodOver' : 'remaining'}
      spent={status.spentToday}
      allowance={status.allowance}
      labels={{
        spent: t('home.spentToday'),
        allowance: t('home.allowance'),
        heading: t('home.spentOfAllowance'),
      }}
      use={todayUse(status)}
      money={money}
    />
  );
}

/**
 * Renders this week's numbers (BR-CALC-10, BR-DSH-07): remaining this week
 * as the hero, under a label with the week's days left, e.g. "Remaining this
 * week (4 days)", and the week's spending against the weekly allowance. While the
 * period is overspent, its overspend is the hero, as on today's card. It is
 * colored by the share of the weekly allowance spent, as today's card is by
 * the daily allowance's, and red over it.
 */
export function WeekCard({
  status,
  period,
  money,
}: {
  status: WeekStatus;
  period: Period;
  money: Money;
}) {
  const { t } = useTranslation();
  const periodOver = status.periodOverspend > 0;
  const over = periodOver || (status.remaining ?? 0) < 0;
  return (
    <StatusCard
      hero={
        periodOver
          ? { label: t('home.periodOver'), value: -status.periodOverspend }
          : {
              label: t('home.remainingWeek', { count: status.daysLeft }),
              value: status.remaining ?? 0,
            }
      }
      heroKey={`${period.start}-${periodOver ? 'periodOver' : 'remaining'}`}
      spent={status.spent}
      allowance={status.allowance}
      labels={{
        spent: t('home.spentWeek'),
        allowance: t('home.weekAllowance'),
        heading: t('home.spentOfWeekAllowance'),
      }}
      use={over ? 'critical' : allowanceUse(status.spent, status.allowance)}
      money={money}
    />
  );
}

/**
 * Renders the period's numbers (BR-DSH-03, BR-DSH-07): the budget left as
 * the hero (BR-CALC-08), under a label with the days left, e.g. "Remaining
 * this period (16 days)",
 * negative once the period is overspent (BR-DSH-02), and spending to date
 * against the spending budget. It is colored by the share of the budget
 * spent, in the same bands as today's card.
 *
 * It expands to the period summary: planned and extra income, fixed
 * expenses, the saving target, big purchases, spending to date, the budget
 * left, and the days left. Income, fixed expenses, and the target open their
 * editor.
 */
export function PeriodCard({
  summary,
  money,
  onEdit,
  expanded,
  onToggle,
}: {
  summary: PeriodSummary;
  money: Money;
  /** Opens the editor of the period's income, fixed expenses, or saving target (BR-INC-01, BR-TGT-01). */
  onEdit: (item: EditableItem) => void;
  /** Whether it shows the summary; the home screen collapses it when another card is shown. */
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

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
    { label: t('home.spentToDate'), value: summary.spentToDate, format: money },
    // Budget left goes negative, in red, once the period is overspent (BR-DSH-02).
    { label: t('home.budgetLeft'), value: summary.budgetLeft, format: money },
    {
      label: t('home.daysLeftLabel'),
      value: summary.daysLeft,
      format: (count) => t('home.daysLeft', { count }),
    },
  ];

  return (
    <StatusCard
      hero={{
        label: t('home.remainingPeriod', { count: summary.daysLeft }),
        value: summary.budgetLeft,
      }}
      heroKey="budgetLeft"
      spent={summary.spentToDate}
      allowance={summary.budget}
      labels={{
        spent: t('home.spentToDate'),
        allowance: t('home.spendingBudget'),
        heading: t('home.spentOfBudget'),
      }}
      use={summary.budgetLeft < 0 ? 'critical' : allowanceUse(summary.spentToDate, summary.budget)}
      money={money}
      details={{
        label: t('home.periodDetails'),
        content: <SummaryRows rows={rows} onEdit={onEdit} />,
        expanded,
        onToggle,
      }}
    />
  );
}
