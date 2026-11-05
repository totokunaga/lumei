// Creating the next periods when the current one ends (BR-PER-03).
import { addDays, type IsoDate } from './date';
import type { Minor } from './money';
import { periodContaining, type StartDay } from './period';

/** A period and the items it holds, as stored but without the sync columns. */
export interface PeriodRows {
  period: { id: string; startDate: IsoDate; endDate: IsoDate };
  incomes: { id: string; periodId: string; name: string; amount: Minor; position: number }[];
  fixedExpenses: {
    id: string;
    periodId: string;
    name: string;
    amount: Minor;
    note: string | null;
    position: number;
  }[];
  /** Null when the period has no saving target. */
  savingTarget: { id: string; periodId: string; amount: Minor } | null;
}

/**
 * Works out the periods to create after the latest one, up to the one
 * containing today (BR-PER-03). Each starts the day after the one before
 * ends, so periods never leave a gap, and ends where the start day says
 * (BR-PER-01, BR-PER-02). Each copies the income, fixed expenses, and saving
 * target of the one before. Every ID derives from what it copies (see
 * docs/architecture/offline-sync.md), so two devices rolling over offline
 * create the same records.
 * @param latest The latest period the account has, with its items.
 * @param derivedId Derives the same ID from the same parts on every device (`src/db/ids.ts`).
 * @returns The new periods, oldest first: none while `latest` hasn't ended,
 *   and more than one if the app wasn't opened for a whole period.
 */
export const nextPeriods = (
  latest: PeriodRows,
  {
    userId,
    startDay,
    today,
    derivedId,
  }: {
    userId: string;
    startDay: StartDay;
    today: IsoDate;
    derivedId: (...parts: string[]) => string;
  },
): PeriodRows[] => {
  const created: PeriodRows[] = [];
  let previous = latest;
  while (previous.period.endDate < today) {
    const startDate = addDays(previous.period.endDate, 1);
    const periodId = derivedId(userId, 'period', startDate);
    const next: PeriodRows = {
      period: { id: periodId, startDate, endDate: periodContaining(startDate, startDay).end },
      incomes: previous.incomes.map((item) => ({
        ...item,
        id: derivedId(periodId, item.id),
        periodId,
      })),
      fixedExpenses: previous.fixedExpenses.map((item) => ({
        ...item,
        id: derivedId(periodId, item.id),
        periodId,
      })),
      savingTarget: previous.savingTarget && {
        id: derivedId(periodId, 'saving-target'),
        periodId,
        amount: previous.savingTarget.amount,
      },
    };
    created.push(next);
    previous = next;
  }
  return created;
};
