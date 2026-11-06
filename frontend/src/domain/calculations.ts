// The calculations of the business requirements (BR-CALC-01 to BR-CALC-08).
// They run on the device, so today's status and the chart work offline
// (BR-OFF-02).
import { addDays, daysBetween, type IsoDate } from '@/domain/date';
import { Fraction } from '@/domain/fraction';
import type { Minor } from '@/domain/money';
import { inPeriod, periodDays, type Period } from '@/domain/period';

export interface Expense {
  amount: Minor;
  date: IsoDate;
  isBigPurchase: boolean;
}

/** Extra income: money that arrives unplanned on a day (BR-INC-06). */
export interface ExtraIncome {
  amount: Minor;
  date: IsoDate;
}

/** Which days carry a big purchase in the chart (BR-SET-05). */
export type BigPurchaseSpread = 'daysLeft' | 'wholePeriod';

/** What a period's numbers are calculated from. */
export interface PeriodRecords {
  period: Period;
  income: Minor[];
  fixedExpenses: Minor[];
  savingTarget: Minor;
  /** Expenses dated outside `period` are ignored. */
  expenses: Expense[];
  /** Extra income (BR-INC-06); none when omitted. Dated outside `period`, it is ignored. */
  extraIncome?: ExtraIncome[];
}

/**
 * Adds up amounts.
 * @returns The total of `amounts`, or 0 for an empty list.
 */
const sum = (amounts: Minor[]): Minor => amounts.reduce((total, amount) => total + amount, 0);

/**
 * Drops expenses dated outside the period, so callers may pass extra ones.
 * @returns The expenses whose date falls in the period.
 */
const expensesIn = ({ period, expenses }: PeriodRecords): Expense[] =>
  expenses.filter((expense) => inPeriod(period, expense.date));

/**
 * Counts the days left in the current period (BR-CALC-01).
 * @returns The days from today to the end of the period, today included: 1 on the last day.
 * @throws RangeError if today is outside the period.
 */
export const daysLeft = (period: Period, today: IsoDate): number => {
  if (!inPeriod(period, today)) {
    throw new RangeError(`today (${today}) is outside the period ${period.start}–${period.end}`);
  }
  return daysBetween(today, period.end) + 1;
};

/**
 * Adds up the period's extra income that arrived by a day (BR-INC-06).
 * @param asOf The last day counted; every day of the period when omitted.
 * @returns The total, 0 without any.
 */
export const extraIncomeBy = (records: PeriodRecords, asOf?: IsoDate): Minor =>
  sum(
    (records.extraIncome ?? [])
      .filter((income) => inPeriod(records.period, income.date))
      .filter((income) => asOf === undefined || income.date <= asOf)
      .map((income) => income.amount),
  );

/**
 * Works out how much the period allows for expenses as of a day
 * (BR-CALC-02): extra income counts from the day it arrives.
 * @param asOf The day; with it omitted, only planned income counts.
 * @returns Planned income + extra income so far − fixed expenses − saving
 *   target, in minor units. Negative if the target is more than that
 *   (BR-TGT-03).
 */
export const spendingBudget = (records: PeriodRecords, asOf?: IsoDate): Minor =>
  sum(records.income) +
  (asOf === undefined ? 0 : extraIncomeBy(records, asOf)) -
  sum(records.fixedExpenses) -
  records.savingTarget;

export interface TodayStatus {
  daysLeft: number;
  /**
   * How much the user can spend today and stay on track (BR-CALC-03). Fixed
   * for the day: today's expenses lower `remainingToday`, not this. 0 while
   * the period is overspent.
   */
  allowance: Minor;
  /** Today's expenses, big purchases excluded (BR-CALC-04). */
  spentToday: Minor;
  /**
   * `allowance − spentToday`, negative when today is overspent. Null while the
   * period is overspent, when it isn't shown (BR-CALC-04, BR-DSH-02).
   */
  remainingToday: Minor | null;
  /**
   * Every expense in the period, today's and big purchases included, minus the
   * budget, once that is positive; otherwise 0 (BR-CALC-03, BR-DSH-02).
   */
  periodOverspend: Minor;
}

/**
 * Works out today's numbers for the home screen (BR-CALC-03, BR-CALC-04,
 * BR-DSH-01, BR-DSH-02): the daily allowance, what was spent today, what is
 * left today, and how far the period is overspent.
 * @returns Today's status; see `TodayStatus` for each field.
 * @throws RangeError if today is outside the period.
 */
export const todayStatus = (records: PeriodRecords, today: IsoDate): TodayStatus => {
  const days = daysLeft(records.period, today);
  const expenses = expensesIn(records);
  const bigPurchases = sum(expenses.filter((e) => e.isBigPurchase).map((e) => e.amount));
  const others = expenses.filter((e) => !e.isBigPurchase);
  const spentBefore = sum(others.filter((e) => e.date < today).map((e) => e.amount));
  const spentToday = sum(others.filter((e) => e.date === today).map((e) => e.amount));

  const available = spendingBudget(records, today) - bigPurchases - spentBefore;
  // Expenses can't be dated after today (BR-EXP-02), so this is every expense in the period.
  const periodOverspend = Math.max(0, spentToday - available);
  if (periodOverspend > 0) {
    return { daysLeft: days, allowance: 0, spentToday, remainingToday: null, periodOverspend };
  }
  // Integer division, so the allowance is exact and rounded down to the minor unit.
  const allowance = Number(BigInt(available) / BigInt(days));
  return {
    daysLeft: days,
    allowance,
    spentToday,
    remainingToday: allowance - spentToday,
    periodOverspend: 0,
  };
};

export interface PeriodResult {
  /**
   * Planned and extra income − fixed expenses − every expense, big purchases
   * included (BR-CALC-07).
   */
  saved: Minor;
  targetMet: boolean;
}

/**
 * Works out how much the period saved, with big purchases included in full
 * (BR-CALC-07, BR-HIS-02).
 * @returns The amount saved, negative if income was overspent, and whether
 *   it met the saving target.
 */
export const periodResult = (records: PeriodRecords): PeriodResult => {
  const saved =
    sum(records.income) +
    extraIncomeBy(records) -
    sum(records.fixedExpenses) -
    sum(expensesIn(records).map((e) => e.amount));
  return { saved, targetMet: saved >= records.savingTarget };
};

export interface PeriodSummary {
  /** Planned income (BR-INC-01). */
  income: Minor;
  /** Extra income received so far (BR-INC-06). */
  extraIncome: Minor;
  fixedExpenses: Minor;
  bigPurchases: Minor;
  savingTarget: Minor;
  /** Every expense in the period so far, big purchases included (BR-CALC-08). */
  spentToDate: Minor;
  /** `budget − spentToDate`, negative once the period is overspent (BR-CALC-08). */
  budgetLeft: Minor;
  daysLeft: number;
}

/**
 * Works out the home screen's period summary (BR-DSH-03): the period's
 * totals, the spending to date and budget left (BR-CALC-08), and the days
 * left (BR-CALC-01).
 * @returns The summary; see `PeriodSummary` for each field.
 * @throws RangeError if today is outside the period.
 */
export const periodSummary = (records: PeriodRecords, today: IsoDate): PeriodSummary => {
  const expenses = expensesIn(records);
  const spentToDate = sum(expenses.map((e) => e.amount));
  return {
    income: sum(records.income),
    extraIncome: extraIncomeBy(records, today),
    fixedExpenses: sum(records.fixedExpenses),
    bigPurchases: sum(expenses.filter((e) => e.isBigPurchase).map((e) => e.amount)),
    savingTarget: records.savingTarget,
    spentToDate,
    budgetLeft: spendingBudget(records, today) - spentToDate,
    daysLeft: daysLeft(records.period, today),
  };
};

export interface ChartDay {
  date: IsoDate;
  /** The spending limit line (BR-CALC-06). */
  limit: Fraction;
  /** The day's bar (BR-CALC-05). Null after today: future days show only the limit (BR-CHT-03). */
  spending: Fraction | null;
  /** The cumulative spending line. Null after today. */
  cumulative: Fraction | null;
}

export interface ProgressChart {
  days: ChartDay[];
  /**
   * Today's marker and its distance from the limit (BR-CHT-01, BR-CHT-02).
   * `underLimit` is `limit − cumulative`, so a negative value is over the limit.
   * Null when today is outside the period.
   */
  today: { cumulative: Fraction; limit: Fraction; underLimit: Fraction } | null;
}

/**
 * Works out the data of the progress chart (BR-CALC-05, BR-CALC-06, BR-CHT-01
 * to BR-CHT-03): for every day of the period, its spending limit, and up to
 * today its spending bar and cumulative spending. Big purchases are spread
 * over days as `spread` says. Every value is exact.
 * @returns One entry per day of the period, in date order, and today's
 *   marker and distance from the limit.
 */
export const progressChart = (
  records: PeriodRecords,
  today: IsoDate,
  spread: BigPurchaseSpread,
): ProgressChart => {
  const { period } = records;
  const length = periodDays(period);
  const expenses = expensesIn(records);
  const bigPurchases = expenses.filter((e) => e.isBigPurchase);

  /**
   * Works out the part of a big purchase that a day's bar carries (BR-CALC-05).
   * @returns The purchase's amount divided by the days it is spread over, or 0
   *   for a day before the purchase under the days-left spread.
   */
  const share = (purchase: Expense, date: IsoDate): Fraction => {
    if (spread === 'wholePeriod') {
      return Fraction.of(purchase.amount, length);
    }
    if (date < purchase.date) {
      return Fraction.ZERO;
    }
    return Fraction.of(purchase.amount, daysBetween(purchase.date, period.end) + 1);
  };

  const days: ChartDay[] = [];
  let cumulative = Fraction.ZERO;
  for (let n = 1; n <= length; n++) {
    const date = addDays(period.start, n - 1);
    // The budget as of the day, so extra income raises the line from the day it arrives.
    const limit = Fraction.of(spendingBudget(records, date) * n, length);
    if (date > today) {
      days.push({ date, limit, spending: null, cumulative: null });
      continue;
    }
    const regular = sum(
      expenses.filter((e) => !e.isBigPurchase && e.date === date).map((e) => e.amount),
    );
    const spending = bigPurchases.reduce(
      (total, purchase) => total.plus(share(purchase, date)),
      Fraction.of(regular),
    );
    cumulative = cumulative.plus(spending);
    days.push({ date, limit, spending, cumulative });
  }

  const todayPoint = days.find((day) => day.date === today);
  return {
    days,
    today:
      todayPoint?.cumulative != null
        ? {
            cumulative: todayPoint.cumulative,
            limit: todayPoint.limit,
            underLimit: todayPoint.limit.minus(todayPoint.cumulative),
          }
        : null,
  };
};
