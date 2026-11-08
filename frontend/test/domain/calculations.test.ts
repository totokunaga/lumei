import {
  daysLeft,
  periodResult,
  periodSummary,
  progressChart,
  spendingBudget,
  todayStatus,
  weekIn,
  weekStatus,
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

describe('weekIn (BR-CALC-10)', () => {
  const period = { start: '2026-10-25', end: '2026-11-24' };

  it.each([
    { name: 'Monday to Sunday', day: '2026-10-29', start: '2026-10-26', end: '2026-11-01' },
    { name: 'the same week on its Monday', day: '2026-10-26', start: '2026-10-26', end: '2026-11-01' },
    { name: 'the same week on its Sunday', day: '2026-11-01', start: '2026-10-26', end: '2026-11-01' },
    { name: 'a first week cut to the period’s start', day: '2026-10-25', start: '2026-10-25', end: '2026-10-25' },
    { name: 'a last week cut to the period’s end', day: '2026-11-24', start: '2026-11-23', end: '2026-11-24' },
  ])('finds $name', ({ day, start, end }) => {
    expect(weekIn(period, day)).toEqual({ start, end });
  });
});

describe('weekStatus (BR-CALC-10)', () => {
  it.each([
    {
      // (170,231 − 28,000 big purchase − 3,000 on Oct 25) × 7 / 30 days from Oct 26 = 32,487.2…
      name: 'the worked example’s week, its expenses so far against an allowance set on Monday',
      records: workedExample,
      date: today,
      expected: {
        start: '2026-10-26',
        end: '2026-11-01',
        days: 7,
        daysLeft: 4,
        allowance: 32_487,
        spent: 12_007,
        remaining: 20_480,
        periodOverspend: 0,
      },
    },
    {
      // The period starts on a Sunday, so its first week is that day alone: (170,231 − 28,000) / 31.
      name: 'a first week of one day, the period’s start on a Sunday',
      records: workedExample,
      date: '2026-10-25',
      expected: {
        start: '2026-10-25',
        end: '2026-10-25',
        days: 1,
        daysLeft: 1,
        allowance: 4_588,
        spent: 3_000,
        remaining: 1_588,
        periodOverspend: 0,
      },
    },
    {
      // Nov 9 – Nov 10: 10,000 − 1,000 before the week, over 2 days, for 2 days.
      name: 'a last week of two days, the period’s end on a Tuesday',
      records: usd([expense('2026-11-02', 1_000), expense('2026-11-09', 300)]),
      date: '2026-11-10',
      expected: {
        start: '2026-11-09',
        end: '2026-11-10',
        days: 2,
        daysLeft: 1,
        allowance: 9_000,
        spent: 300,
        remaining: 8_700,
        periodOverspend: 0,
      },
    },
    {
      // Nov 2 – Nov 8, from Monday: 10,000 × 7 / 9 days = 7,777.7…, rounded down.
      name: 'an allowance rounded down to the minor unit',
      records: usd([]),
      date: '2026-11-04',
      expected: {
        start: '2026-11-02',
        end: '2026-11-08',
        days: 7,
        daysLeft: 5,
        allowance: 7_777,
        spent: 0,
        remaining: 7_777,
        periodOverspend: 0,
      },
    },
    {
      // A big purchase during the week lowers the allowance; it isn't spent this week.
      name: 'a big purchase this week, which lowers the allowance but not spent this week',
      records: usd([expense('2026-11-03', 4_500, true), expense('2026-11-04', 500)]),
      date: '2026-11-04',
      expected: {
        start: '2026-11-02',
        end: '2026-11-08',
        days: 7,
        daysLeft: 5,
        allowance: 4_277,
        spent: 500,
        remaining: 3_777,
        periodOverspend: 0,
      },
    },
    {
      name: 'an overspent period: no allowance, and the overspend',
      records: usd([expense('2026-11-01', 6_000, true), expense('2026-11-03', 4_500)]),
      date: '2026-11-03',
      expected: {
        start: '2026-11-02',
        end: '2026-11-08',
        days: 7,
        daysLeft: 6,
        allowance: 0,
        spent: 4_500,
        remaining: null,
        periodOverspend: 500,
      },
    },
  ])('returns $name', ({ records, date, expected }) => {
    expect(weekStatus(records, date)).toEqual(expected);
  });

  it('rejects a day outside the period', () => {
    expect(() => weekStatus(usd([]), '2026-11-11')).toThrow(RangeError);
  });
});

describe('periodSummary (BR-CALC-08, BR-DSH-03)', () => {
  it.each([
    {
      name: 'the worked example’s totals',
      records: workedExample,
      today,
      expected: {
        income: 640_808,
        extraIncome: 0,
        fixedExpenses: 70_577,
        bigPurchases: 28_000,
        savingTarget: 400_000,
        budget: 170_231,
        spentToDate: 43_007,
        budgetLeft: 127_224,
        daysLeft: 27,
      },
    },
    {
      name: 'a negative budget left once the period is overspent',
      records: usd([expense('2026-11-01', 6_000, true), expense('2026-11-02', 4_500)]),
      today: '2026-11-02',
      expected: expect.objectContaining({ spentToDate: 10_500, budgetLeft: -500, daysLeft: 9 }),
    },
    {
      name: 'only the period’s expenses',
      records: usd([expense('2026-10-31', 9_999), expense('2026-11-01', 100)]),
      today: '2026-11-01',
      expected: expect.objectContaining({ spentToDate: 100, budgetLeft: 9_900 }),
    },
  ])('returns $name', ({ records, today: date, expected }) => {
    expect(periodSummary(records, date)).toEqual(expected);
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

describe('extra income (BR-INC-06, BR-CALC-02)', () => {
  // The USD period with $30.00 arriving on Nov 4 and $5.00 on Nov 6.
  const withExtra = (expenses: Expense[] = []): PeriodRecords => ({
    ...usd(expenses),
    extraIncome: [
      { date: '2026-11-04', amount: 3_000 },
      { date: '2026-11-06', amount: 500 },
      // Outside the period, so ignored.
      { date: '2026-10-31', amount: 99_999 },
    ],
  });

  it.each([
    { name: 'only planned income without a day', asOf: undefined, expected: 10_000 },
    { name: 'nothing before it arrives', asOf: '2026-11-03', expected: 10_000 },
    { name: 'the income from the day it arrives', asOf: '2026-11-04', expected: 13_000 },
    { name: 'every income by the end', asOf: '2026-11-10', expected: 13_500 },
  ])('adds to the budget $name', ({ asOf, expected }) => {
    expect(spendingBudget(withExtra(), asOf)).toBe(expected);
  });

  it.each([
    // ($100 − $10 spent before today) / 8 days left.
    { name: 'leaves the allowance before it arrives', today: '2026-11-03', allowance: 1_125 },
    // ($100 + $30 − $10 spent before today) / 7 days left.
    { name: 'raises the allowance from the day it arrives', today: '2026-11-04', allowance: 1_714 },
  ])('$name', ({ today: date, allowance }) => {
    const records = withExtra([expense('2026-11-01', 1_000)]);

    expect(todayStatus(records, date).allowance).toBe(allowance);
  });

  it('counts in the summary as received so far, and in the budget left', () => {
    expect(periodSummary(withExtra([expense('2026-11-01', 1_000)]), '2026-11-05')).toMatchObject({
      income: 20_000,
      extraIncome: 3_000,
      budgetLeft: 12_000,
    });
  });

  it('counts in full in the amount saved (BR-CALC-07)', () => {
    // $200 + $35 − $50 fixed − $10 spent.
    expect(periodResult(withExtra([expense('2026-11-01', 1_000)]))).toEqual({
      saved: 17_500,
      targetMet: true,
    });
  });

  it('raises the chart’s limit line from the day it arrives (BR-CALC-06)', () => {
    const chart = progressChart(withExtra(), '2026-11-10', 'daysLeft');

    expect(chart.days[2].limit.toNumber()).toBe(3_000); // Nov 3: $100 × 3 / 10.
    expect(chart.days[3].limit.toNumber()).toBe(5_200); // Nov 4: $130 × 4 / 10.
    expect(chart.days[9].limit.toNumber()).toBe(13_500); // the whole budget by the end.
  });
});
