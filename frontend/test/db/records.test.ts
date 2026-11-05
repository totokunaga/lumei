import { act, renderHook } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import { useDataVersion } from '@/db/changes';
import { type Database, openUserDatabase } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import {
  addExpense,
  countFailedChanges,
  countPendingChanges,
  ensureCurrentPeriod,
  readCategories,
  readFirstPeriodStart,
  readPeriodExpenses,
  readPeriodRecords,
  readSettings,
  saveSetup,
} from '@/db/records';
import { categories, expenses, incomes, periods, savingTargets } from '@/db/schema';
import { buildSetupRecords, type SetupChoices } from '@/domain/setup';

import { japanSet } from '../helpers/category-sets';

const choices: SetupChoices = {
  set: japanSet,
  currency: 'JPY',
  periodStartDay: 25,
  incomes: [{ name: 'Salary', amount: 640_808 }],
  fixedExpenses: [{ name: 'House Rent', amount: 120_000, note: null }],
  savingTarget: 100_000,
};

/** Saves a finished setup for user-1 on Oct 29, 2026, as the setup screens do. */
const saveFinishedSetup = async (overrides: Partial<SetupChoices> = {}) => {
  const db = await openUserDatabase('user-1');
  const records = buildSetupRecords(
    { ...choices, ...overrides },
    { userId: 'user-1', language: 'en', today: '2026-10-29', now: 1_000, ids: { newId, derivedId } },
  );
  saveSetup(db, records, 1_000);
  return db;
};

describe('saveSetup and readSettings (BR-ACC-06)', () => {
  it.each([
    {
      name: 'null before setup has finished',
      setup: () => openUserDatabase('user-1'),
      expected: null,
    },
    {
      name: 'the settings once setup has finished, pending sync (BR-OFF-04)',
      setup: () => saveFinishedSetup(),
      expected: expect.objectContaining({
        id: 'user-1',
        currency: 'JPY',
        periodStartDay: 25,
        updatedAt: 1_000,
        deletedAt: null,
        pending: true,
        localRev: 1,
      }),
    },
  ])('reads $name', async ({ setup, expected }) => {
    const db = await setup();

    expect(readSettings(db)).toEqual(expected);
  });
});

describe('readPeriodRecords (BR-CALC-01)', () => {
  it.each([
    {
      name: 'the records of the period containing the date',
      overrides: {},
      date: '2026-11-24',
      expected: {
        period: { start: '2026-10-25', end: '2026-11-24' },
        income: [640_808],
        fixedExpenses: [120_000],
        savingTarget: 100_000,
        expenses: [],
      },
    },
    {
      name: 'a target of 0 when the step was skipped',
      overrides: { savingTarget: null, incomes: [], fixedExpenses: [] },
      date: '2026-10-25',
      expected: {
        period: { start: '2026-10-25', end: '2026-11-24' },
        income: [],
        fixedExpenses: [],
        savingTarget: 0,
        expenses: [],
      },
    },
    { name: 'null outside every period', overrides: {}, date: '2026-11-25', expected: null },
  ])('returns $name', async ({ overrides, date, expected }) => {
    const db = await saveFinishedSetup(overrides);

    expect(readPeriodRecords(db, date)).toEqual(expected);
  });
});

describe('countPendingChanges (BR-OFF-04)', () => {
  it.each([
    { name: '0 before anything is saved', save: false, expected: 0 },
    // Settings, 2 categories, the period, an income, a fixed expense, and the target.
    { name: 'every row setup saved', save: true, expected: 7 },
  ])('counts $name', async ({ save, expected }) => {
    const db = save ? await saveFinishedSetup() : await openUserDatabase('user-1');

    expect(countPendingChanges(db)).toBe(expected);
  });

  it('counts the rejected rows too, and countFailedChanges only them', async () => {
    const db = await saveFinishedSetup();
    db.update(categories).set({ pending: false }).run();
    db.update(periods).set({ syncError: 'invalid_row' }).run();

    // Settings, the period, the income, the fixed expense, and the target.
    expect(countPendingChanges(db)).toBe(5);
    expect(countFailedChanges(db)).toBe(1);
  });
});

/** Saves an expense at noon on a date in the first category, as the expense sheet does. */
const spend = (db: Database, date: string, amount: number, isBigPurchase = false, id = newId()) => {
  const [year, month, day] = date.split('-').map(Number);
  const spentAt = new Date(year, month - 1, day, 12).getTime();
  addExpense(db, { amount, categoryId: readCategories(db)[0].id, spentAt, isBigPurchase }, id, 2_000);
  return id;
};

describe('addExpense (BR-EXP-01, BR-OFF-01)', () => {
  it('saves the expense dated by the device’s time zone, pending sync', async () => {
    const db = await saveFinishedSetup();

    const id = spend(db, '2026-10-29', 1_137);

    expect(db.select().from(expenses).all()).toEqual([
      {
        id,
        amount: 1_137,
        categoryId: readCategories(db)[0].id,
        date: '2026-10-29',
        spentAt: new Date(2026, 9, 29, 12).getTime(),
        isBigPurchase: false,
        description: null,
        latitude: null,
        longitude: null,
        updatedAt: 2_000,
        deletedAt: null,
        pending: true,
        localRev: 1,
        syncError: null,
      },
    ]);
    expect(countPendingChanges(db)).toBe(8);
  });

  it('tells screens to read the records again (BR-DSH-04)', async () => {
    const db = await saveFinishedSetup();
    const { result } = await renderHook(() => useDataVersion());
    const before = result.current;

    await act(() => void spend(db, '2026-10-29', 500));

    expect(result.current).toBe(before + 1);
  });
});

describe('readPeriodRecords with expenses (BR-EXP-07)', () => {
  it('returns the period’s expenses, without deleted ones or other periods’', async () => {
    const db = await saveFinishedSetup();
    spend(db, '2026-10-24', 9_999);
    spend(db, '2026-10-25', 3_000);
    spend(db, '2026-10-27', 28_000, true);
    const deleted = spend(db, '2026-10-28', 5_000);
    db.update(expenses).set({ deletedAt: 3_000 }).where(eq(expenses.id, deleted)).run();
    spend(db, '2026-11-25', 1_000);

    expect(readPeriodRecords(db, '2026-10-29')?.expenses).toEqual([
      { amount: 3_000, date: '2026-10-25', isBigPurchase: false },
      { amount: 28_000, date: '2026-10-27', isBigPurchase: true },
    ]);
  });
});

describe('readCategories (BR-CAT-02, BR-CAT-03)', () => {
  it('returns the active categories in the user’s order', async () => {
    const db = await saveFinishedSetup();
    const [eatOut, konbini] = readCategories(db);
    db.update(categories).set({ position: 5 }).where(eq(categories.id, eatOut.id)).run();
    expect(readCategories(db).map((c) => c.name)).toEqual(['Konbini', 'Eat Out']);

    db.update(categories).set({ archivedAt: 3_000 }).where(eq(categories.id, konbini.id)).run();

    expect(readCategories(db)).toEqual([{ id: eatOut.id, name: 'Eat Out', emoji: '🍔' }]);
  });
});

describe('readFirstPeriodStart (BR-EXP-02)', () => {
  it.each([
    { name: 'null before setup has finished', save: false, rollTo: null, expected: null },
    { name: 'the setup period’s start', save: true, rollTo: null, expected: '2026-10-25' },
    { name: 'still the first start after a rollover', save: true, rollTo: '2026-12-01', expected: '2026-10-25' },
  ])('returns $name', async ({ save, rollTo, expected }) => {
    const db = save ? await saveFinishedSetup() : await openUserDatabase('user-1');
    if (rollTo) {
      ensureCurrentPeriod(db, rollTo, 3_000);
    }

    expect(readFirstPeriodStart(db)).toBe(expected);
  });
});

describe('ensureCurrentPeriod (BR-PER-03)', () => {
  it.each([
    { name: 'nothing while the period hasn’t ended', today: '2026-11-24', expected: 0 },
    { name: 'the next period after it ends', today: '2026-11-25', expected: 1 },
    { name: 'every period missed while the app was closed', today: '2027-01-25', expected: 3 },
  ])('creates $name', async ({ today, expected }) => {
    const db = await saveFinishedSetup();

    expect(ensureCurrentPeriod(db, today, 3_000)).toBe(expected);
    expect(db.select().from(periods).all()).toHaveLength(1 + expected);
    expect(readPeriodRecords(db, today)).not.toBeNull();
  });

  it('copies the income, fixed expenses, and target, pending sync', async () => {
    const db = await saveFinishedSetup();

    ensureCurrentPeriod(db, '2026-11-25', 3_000);

    expect(readPeriodRecords(db, '2026-11-25')).toEqual({
      period: { start: '2026-11-25', end: '2026-12-24' },
      income: [640_808],
      fixedExpenses: [120_000],
      savingTarget: 100_000,
      expenses: [],
    });
    const november = derivedId('user-1', 'period', '2026-11-25');
    expect(db.select().from(savingTargets).where(eq(savingTargets.periodId, november)).get()).toMatchObject({
      id: derivedId(november, 'saving-target'),
      updatedAt: 3_000,
      pending: true,
    });
  });

  it('keeps a copy another device already made, rather than doubling it', async () => {
    const db = await saveFinishedSetup();
    const salary = db.select().from(incomes).get()!;
    const november = derivedId('user-1', 'period', '2026-11-25');
    // Another device rolled over first and raised the copied salary; this device pulled that row.
    db.insert(incomes)
      .values({ ...salary, id: derivedId(november, salary.id), periodId: november, amount: 700_000 })
      .run();

    expect(ensureCurrentPeriod(db, '2026-11-25', 3_000)).toBe(1);

    expect(readPeriodRecords(db, '2026-11-25')?.income).toEqual([700_000]);
    expect(ensureCurrentPeriod(db, '2026-11-25', 4_000)).toBe(0);
  });

  it('does nothing before setup has finished', async () => {
    const db = await openUserDatabase('user-1');

    expect(ensureCurrentPeriod(db, '2026-11-25', 3_000)).toBe(0);
  });
});

describe('readPeriodExpenses (BR-DSH-06)', () => {
  it('returns the period’s expenses with their category, newest first', async () => {
    const db = await saveFinishedSetup();
    spend(db, '2026-10-24', 9_999);
    // UUIDv7s made in the same millisecond don't sort by creation, so these two get set ones.
    const first = spend(db, '2026-10-26', 1_000, false, '0199a6c5-0000-7000-8000-000000000001');
    const big = spend(db, '2026-10-28', 28_000, true);
    // Recorded later for the same moment, so it lists above the first.
    const sameMoment = spend(db, '2026-10-26', 500, false, '0199a6c5-0000-7000-8000-000000000002');
    const deleted = spend(db, '2026-10-27', 300);
    db.update(expenses).set({ deletedAt: 3_000 }).where(eq(expenses.id, deleted)).run();
    // An archived category still shows on its expenses (BR-CAT-03).
    db.update(categories).set({ archivedAt: 3_000 }).run();

    const listed = readPeriodExpenses(db, '2026-10-29');

    expect(listed.map((e) => e.id)).toEqual([big, sameMoment, first]);
    expect(listed[0]).toEqual({
      id: big,
      amount: 28_000,
      date: '2026-10-28',
      spentAt: new Date(2026, 9, 28, 12).getTime(),
      isBigPurchase: true,
      categoryName: 'Eat Out',
      categoryEmoji: '🍔',
      sync: 'pending',
    });
  });

  it.each([
    { name: 'synced once the API confirmed it', pending: false, syncError: null, sync: 'synced' },
    { name: 'pending until then', pending: true, syncError: null, sync: 'pending' },
    { name: 'failed when the API rejected it', pending: true, syncError: 'invalid_row', sync: 'failed' },
  ])('says the expense is $name (BR-OFF-04)', async ({ pending, syncError, sync }) => {
    const db = await saveFinishedSetup();
    const id = spend(db, '2026-10-28', 500);
    db.update(expenses).set({ pending, syncError }).where(eq(expenses.id, id)).run();

    expect(readPeriodExpenses(db, '2026-10-29')).toMatchObject([{ id, sync }]);
  });

  it('returns nothing when no period contains the date', async () => {
    const db = await saveFinishedSetup();

    expect(readPeriodExpenses(db, '2027-01-01')).toEqual([]);
  });
});
