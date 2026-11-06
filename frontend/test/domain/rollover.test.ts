import { nextPeriods, type PeriodRows } from '@/domain/rollover';

/** Joins the parts, so tests can read which record an ID derives from. */
const derivedId = (...parts: string[]) => parts.join('/');

const october: PeriodRows = {
  period: { id: 'p-oct', startDate: '2026-10-25', endDate: '2026-11-24' },
  incomes: [{ id: 'salary', periodId: 'p-oct', name: 'Salary', amount: 640_808, position: 0 }],
  fixedExpenses: [
    { id: 'rent', periodId: 'p-oct', name: 'Rent', amount: 70_000, note: 'Due 27th', position: 0 },
  ],
  savingTarget: { id: 't-oct', periodId: 'p-oct', amount: 400_000 },
};

describe('nextPeriods (BR-PER-03)', () => {
  it.each([
    { name: 'nothing while the latest period hasn’t ended', today: '2026-11-24', starts: [] },
    { name: 'the next period on the day after it ends', today: '2026-11-25', starts: ['2026-11-25'] },
    {
      name: 'every missed period, one after another',
      today: '2027-01-30',
      starts: ['2026-11-25', '2026-12-25', '2027-01-25'],
    },
  ])('creates $name', ({ today, starts }) => {
    const created = nextPeriods(october, { userId: 'u', startDay: 25, today, derivedId });

    expect(created.map((rows) => rows.period.startDate)).toEqual(starts);
  });

  it('copies the income, fixed expenses, and target, with IDs derived from what they copy', () => {
    const [november] = nextPeriods(october, {
      userId: 'u',
      startDay: 25,
      today: '2026-11-25',
      derivedId,
    });

    expect(november).toEqual({
      period: { id: 'u/period/2026-11-25', startDate: '2026-11-25', endDate: '2026-12-24' },
      incomes: [
        { id: 'u/period/2026-11-25/salary', periodId: 'u/period/2026-11-25', name: 'Salary', amount: 640_808, position: 0 },
      ],
      fixedExpenses: [
        {
          id: 'u/period/2026-11-25/rent',
          periodId: 'u/period/2026-11-25',
          name: 'Rent',
          amount: 70_000,
          note: 'Due 27th',
          position: 0,
        },
      ],
      savingTarget: {
        id: 'u/period/2026-11-25/saving-target',
        periodId: 'u/period/2026-11-25',
        amount: 400_000,
      },
    });
  });

  it.each([
    {
      name: 'the start day’s month end when the month lacks it (BR-PER-02)',
      latest: { startDate: '2027-01-31', endDate: '2027-02-27' },
      startDay: 31,
      expected: { startDate: '2027-02-28', endDate: '2027-03-30' },
    },
    {
      name: 'the next start day after a start-day change, without a gap',
      latest: { startDate: '2026-11-01', endDate: '2026-11-30' },
      startDay: 25,
      expected: { startDate: '2026-12-01', endDate: '2026-12-24' },
    },
  ])('ends the new period at $name', ({ latest, startDay, expected }) => {
    const [next] = nextPeriods(
      { ...october, period: { id: 'p', ...latest }, savingTarget: null },
      { userId: 'u', startDay, today: expected.startDate, derivedId },
    );

    expect(next.period).toMatchObject(expected);
    expect(next.savingTarget).toBeNull();
  });
});

describe('nextPeriods after a start-day change (BR-PER-05)', () => {
  it.each([
    {
      name: 'the next period on its chosen end, then the new start day',
      nextPeriodEnd: '2026-12-31',
      periods: [
        ['2026-11-25', '2026-12-31'],
        ['2027-01-01', '2027-01-31'],
      ],
    },
    {
      name: 'the gap as its own period without a chosen end',
      nextPeriodEnd: null,
      periods: [
        ['2026-11-25', '2026-11-30'],
        ['2026-12-01', '2026-12-31'],
        ['2027-01-01', '2027-01-31'],
      ],
    },
  ])('creates $name', ({ nextPeriodEnd, periods }) => {
    const created = nextPeriods(october, {
      userId: 'u',
      startDay: 1,
      today: '2027-01-15',
      derivedId,
      nextPeriodEnd,
    });

    expect(created.map(({ period }) => [period.startDate, period.endDate])).toEqual(periods);
  });

  it('ignores a chosen end the periods have already passed', () => {
    const created = nextPeriods(october, {
      userId: 'u',
      startDay: 25,
      today: '2026-11-25',
      derivedId,
      nextPeriodEnd: '2026-10-31',
    });

    expect(created.map(({ period }) => period.endDate)).toEqual(['2026-12-24']);
  });
});
