import {
  daysLeft,
  periodResult,
  progressChart,
  spendingBudget,
  todayStatus,
  type BigPurchaseSpread,
  type Expense,
  type PeriodRecords,
} from '@/domain/calculations';
import { Fraction } from '@/domain/fraction';

const expense = (date: string, amount: number, isBigPurchase = false): Expense => ({
  date,
  amount,
  isBigPurchase,
});

// The worked example in the business requirements: `26Nov` on Oct 29, 2026, in JPY.
const workedExample: PeriodRecords = {
  period: { start: '2026-10-25', end: '2026-11-24' },
  income: [640_808],
  fixedExpenses: [50_000, 15_000, 5_577],
  savingTarget: 400_000,
  expenses: [
    expense('2026-10-25', 3_000),
    expense('2026-10-26', 2_870),
    expense('2026-10-27', 28_000, true),
    expense('2026-10-28', 5_000),
    expense('2026-10-29', 1_137),
    expense('2026-10-29', 3_000),
  ],
};
const today = '2026-10-29';

// A USD period of 10 days with a budget of $100.00 (10,000 cents).
const usd = (expenses: Expense[]): PeriodRecords => ({
  period: { start: '2026-11-01', end: '2026-11-10' },
  income: [20_000],
  fixedExpenses: [5_000],
  savingTarget: 5_000,
  expenses,
});

describe('daysLeft (BR-CALC-01)', () => {
  const period = { start: '2026-10-25', end: '2026-11-24' };

  it.each([
    { name: 'all days on the first day', date: '2026-10-25', expected: 31 },
    { name: 'today included', date: '2026-10-29', expected: 27 },
    { name: '1 on the last day', date: '2026-11-24', expected: 1 },
  ])('counts $name', ({ date, expected }) => {
    expect(daysLeft(period, date)).toBe(expected);
  });

  it.each([
    { name: 'before the period', date: '2026-10-24' },
    { name: 'after the period', date: '2026-11-25' },
  ])('rejects a date $name', ({ date }) => {
    expect(() => daysLeft(period, date)).toThrow(RangeError);
  });
});

describe('spendingBudget (BR-CALC-02)', () => {
  it('subtracts fixed expenses and the target from income', () => {
    expect(spendingBudget(workedExample)).toBe(170_231);
  });
});

describe('todayStatus (BR-CALC-03, BR-CALC-04)', () => {
  it.each([
    {
      name: 'the worked example',
      records: workedExample,
      date: today,
      expected: {
        daysLeft: 27,
        allowance: 4_865,
        spentToday: 4_137,
        remainingToday: 728,
        periodOverspend: 0,
      },
    },
    {
      name: 'an allowance rounded down to the minor unit',
      records: usd([]),
      date: '2026-11-08', // 3 days left: 10,000 / 3 = 3,333.33…
      expected: {
        daysLeft: 3,
        allowance: 3_333,
        spentToday: 0,
        remainingToday: 3_333,
        periodOverspend: 0,
      },
    },
    {
      name: 'a big purchase today, which lowers the allowance but not spent today',
      records: usd([expense('2026-11-01', 5_000, true)]),
      date: '2026-11-01',
      expected: {
        daysLeft: 10,
        allowance: 500,
        spentToday: 0,
        remainingToday: 500,
        periodOverspend: 0,
      },
    },
    {
      name: 'a late entry for an earlier date, which lowers the allowance but not spent today',
      records: usd([expense('2026-11-01', 2_000)]),
      date: '2026-11-03',
      expected: {
        daysLeft: 8,
        allowance: 1_000,
        spentToday: 0,
        remainingToday: 1_000,
        periodOverspend: 0,
      },
    },
    {
      name: 'today overspent',
      records: usd([expense('2026-11-01', 1_500)]),
      date: '2026-11-01',
      expected: {
        daysLeft: 10,
        allowance: 1_000,
        spentToday: 1_500,
        remainingToday: -500,
        periodOverspend: 0,
      },
    },
    {
      name: 'the budget used up exactly, which is not overspent',
      records: usd([expense('2026-11-01', 9_000, true), expense('2026-11-10', 1_000)]),
      date: '2026-11-10',
      expected: {
        daysLeft: 1,
        allowance: 1_000,
        spentToday: 1_000,
        remainingToday: 0,
        periodOverspend: 0,
      },
    },
    {
      name: 'the period overspent before today (BR-DSH-02)',
      records: usd([expense('2026-11-01', 9_000, true), expense('2026-11-02', 1_200)]),
      date: '2026-11-03',
      expected: {
        daysLeft: 8,
        allowance: 0,
        spentToday: 0,
        remainingToday: null,
        periodOverspend: 200,
      },
    },
    {
      name: "today's spending added to an overspend from before today",
      records: usd([
        expense('2026-11-01', 9_000, true),
        expense('2026-11-02', 1_200),
        expense('2026-11-03', 500),
      ]),
      date: '2026-11-03',
      expected: {
        daysLeft: 8,
        allowance: 0,
        spentToday: 500,
        remainingToday: null,
        periodOverspend: 700,
      },
    },
    {
      name: 'the period overspent by an expense today, which zeroes the allowance at once',
      records: usd([expense('2026-11-01', 9_000, true), expense('2026-11-10', 3_000)]),
      date: '2026-11-10', // The day started with an allowance of 1,000.
      expected: {
        daysLeft: 1,
        allowance: 0,
        spentToday: 3_000,
        remainingToday: null,
        periodOverspend: 2_000,
      },
    },
    {
      name: 'the period overspent by a big purchase today',
      records: usd([expense('2026-11-02', 10_300, true)]),
      date: '2026-11-02',
      expected: {
        daysLeft: 9,
        allowance: 0,
        spentToday: 0,
        remainingToday: null,
        periodOverspend: 300,
      },
    },
    {
      name: 'expenses outside the period ignored',
      records: usd([expense('2026-10-31', 5_000), expense('2026-11-11', 5_000, true)]),
      date: '2026-11-01',
      expected: {
        daysLeft: 10,
        allowance: 1_000,
        spentToday: 0,
        remainingToday: 1_000,
        periodOverspend: 0,
      },
    },
  ])('returns $name', ({ records, date, expected }) => {
    expect(todayStatus(records, date)).toEqual(expected);
  });
});

describe('periodResult (BR-CALC-07)', () => {
  it.each([
    {
      name: 'the target met, big purchases included',
      records: usd([expense('2026-11-01', 6_000, true), expense('2026-11-02', 4_000)]),
      expected: { saved: 5_000, targetMet: true },
    },
    {
      name: 'the target missed by 1 minor unit',
      records: usd([expense('2026-11-01', 10_001)]),
      expected: { saved: 4_999, targetMet: false },
    },
    {
      name: 'a negative result when income is overspent',
      records: usd([expense('2026-11-01', 16_000)]),
      expected: { saved: -1_000, targetMet: false },
    },
  ])('returns $name', ({ records, expected }) => {
    expect(periodResult(records)).toEqual(expected);
  });
});

describe('progressChart (BR-CALC-05, BR-CALC-06)', () => {
  it.each([
    {
      name: 'days left',
      spread: 'daysLeft' as const,
      // 3 of 29 shares of the big purchase: Oct 27 to 29.
      expected: { cumulative: Fraction.of(519_203, 29), underLimit: Fraction.of(8_588_202, 899) },
    },
    {
      name: 'whole period',
      spread: 'wholePeriod' as const,
      // 5 of 31 shares of the big purchase: Oct 25 to 29.
      expected: { cumulative: Fraction.of(605_217, 31), underLimit: Fraction.of(245_938, 31) },
    },
  ])(
    "places today's marker in the worked example with the $name spread",
    ({ spread, expected }) => {
      const chart = progressChart(workedExample, today, spread);

      expect(chart.today).toEqual({ ...expected, limit: Fraction.of(170_231 * 5, 31) });
    },
  );

  it.each([
    {
      name: 'days left',
      spread: 'daysLeft' as const,
      spending: [Fraction.of(0), Fraction.of(1_000), Fraction.of(2_000), Fraction.of(1_000)],
    },
    {
      name: 'whole period',
      spread: 'wholePeriod' as const,
      spending: [Fraction.of(750), Fraction.of(750), Fraction.of(1_750), Fraction.of(750)],
    },
  ])('spreads a big purchase over the $name', ({ spread, spending }) => {
    // 4 days, a $30.00 big purchase on the second day, and $10.00 spent on the third.
    const records: PeriodRecords = {
      period: { start: '2026-11-01', end: '2026-11-04' },
      income: [4_000],
      fixedExpenses: [],
      savingTarget: 0,
      expenses: [expense('2026-11-02', 3_000, true), expense('2026-11-03', 1_000)],
    };

    const chart = progressChart(records, '2026-11-04', spread);

    expect(chart.days.map((day) => day.spending)).toEqual(spending);
  });

  it('stops bars and the cumulative line at today, and draws the limit on every day (BR-CHT-03)', () => {
    const chart = progressChart(usd([expense('2026-11-02', 700)]), '2026-11-02', 'daysLeft');

    expect(chart.days).toHaveLength(10);
    expect(chart.days.slice(0, 2).map((day) => day.cumulative)).toEqual([
      Fraction.of(0),
      Fraction.of(700),
    ]);
    expect(
      chart.days.slice(2).every((day) => day.spending === null && day.cumulative === null),
    ).toBe(true);
    expect(chart.days.map((day) => day.limit)).toEqual(
      Array.from({ length: 10 }, (_, i) => Fraction.of((i + 1) * 1_000)),
    );
  });

  it.each<{ name: string; spread: BigPurchaseSpread }>([
    { name: 'days left', spread: 'daysLeft' },
    { name: 'whole period', spread: 'wholePeriod' },
  ])('ends exactly at the total spent and the budget, with the $name spread', ({ spread }) => {
    const chart = progressChart(workedExample, '2026-12-01', spread);
    const last = chart.days[chart.days.length - 1];

    expect(last.cumulative).toEqual(Fraction.of(43_007));
    expect(last.limit).toEqual(Fraction.of(170_231));
    expect(chart.today).toBeNull();
  });

  it('shows only the limit before the period starts', () => {
    const chart = progressChart(usd([]), '2026-10-31', 'daysLeft');

    expect(chart.days.every((day) => day.spending === null)).toBe(true);
    expect(chart.today).toBeNull();
  });
});
