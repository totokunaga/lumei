// The spending budget the setup choices give, shown on the last steps.
import { spendingBudget } from '@/domain/calculations';
import { localToday } from '@/domain/date';
import type { Minor } from '@/domain/money';
import { periodContaining } from '@/domain/period';

import { useSetupDraft } from './draft';

/**
 * Works out the first period's spending budget from the setup choices:
 * income − fixed expenses − saving target (BR-CALC-02). A skipped target
 * counts as 0.
 * @param savingTarget The target to use instead of the chosen one, e.g. while it is being typed.
 * @returns The budget in minor units; negative when the target can't be met (BR-TGT-03).
 */
export const useDraftBudget = (savingTarget?: Minor | null): Minor => {
  const { incomes, fixedExpenses, periodStartDay, savingTarget: chosen } = useSetupDraft();
  return spendingBudget({
    period: periodContaining(localToday(), periodStartDay),
    income: incomes.map((item) => item.amount),
    fixedExpenses: fixedExpenses.map((item) => item.amount),
    savingTarget: (savingTarget === undefined ? chosen : savingTarget) ?? 0,
    expenses: [],
  });
};
