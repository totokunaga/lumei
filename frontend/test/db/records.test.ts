import { act, renderHook } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import { useDataVersion } from '@/db/changes';
import { type Database, openUserDatabase } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import {
  addExpense,
  addExtraIncome,
  changeStartDay,
  countFailedChanges,
  countPendingChanges,
  deleteExpense,
  deleteExtraIncome,
  ensureCurrentPeriod,
  readCategories,
  readCategory,
  readExpense,
  readExtraIncome,
  readNeighbourPeriods,
  readFirstPeriodStart,
  readPeriodExpenses,
  readPeriodExtraIncome,
  readPeriodItems,
  readPeriodOn,
  readPeriodRecords,
  readSettings,
  saveFixedExpenses,
  saveIncomes,
  saveSavingTarget,
  restoreExpense,
  restoreExtraIncome,
  saveSetup,
  setBigPurchaseSpread,
  updateExpense,
  updateExtraIncome,
} from '@/db/records';
import {
  categories,
  expenses,
  fixedExpenses,
  incomes,
  periods,
  savingTargets,
  settings,
} from '@/db/schema';
import { addDays } from '@/domain/date';
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
        extraIncome: [],
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
        extraIncome: [],
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
      extraIncome: [],
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

describe('changeStartDay (BR-PER-05)', () => {
  // Setup on Oct 29 with start day 25: the current period is Oct 25 – Nov 24.
  it.each([
    {
      name: 'this period to the day before the next new start',
      choice: 'current' as const,
      current: { start: '2026-10-25', end: '2026-11-30' },
      next: { start: '2026-12-01', end: '2026-12-31' },
    },
    {
      name: 'the next period over the gap and the period after it',
      choice: 'next' as const,
      current: { start: '2026-10-25', end: '2026-11-24' },
      next: { start: '2026-11-25', end: '2026-12-31' },
    },
    {
      name: 'the gap into a period of its own',
      choice: 'own' as const,
      current: { start: '2026-10-25', end: '2026-11-24' },
      next: { start: '2026-11-25', end: '2026-11-30' },
    },
  ])('moves $name', async ({ choice, current, next }) => {
    const db = await saveFinishedSetup();

    changeStartDay(db, 1, choice, '2026-10-29', 2_000);

    expect(readPeriodOn(db, '2026-10-29')).toMatchObject(current);
    // The next period appears when this one ends, and the ones after it follow the new day.
    ensureCurrentPeriod(db, addDays(current.end, 1), 3_000);
    expect(readPeriodOn(db, addDays(current.end, 1))).toMatchObject(next);
    ensureCurrentPeriod(db, addDays(next.end, 1), 4_000);
    expect(readPeriodOn(db, addDays(next.end, 1))?.start).toBe(addDays(next.end, 1));
    expect(readSettings(db)?.periodStartDay).toBe(1);
  });

  it('marks what it changed for sync, at the next revision', async () => {
    const db = await saveFinishedSetup();
    db.update(settings).set({ pending: false, syncError: 'invalid_row' }).run();
    db.update(periods).set({ pending: false }).run();

    changeStartDay(db, 1, 'current', '2026-10-29', 2_000);

    const sync = { updatedAt: 2_000, pending: true, syncError: null, localRev: 2 };
    expect(db.select().from(settings).get()).toMatchObject({ ...sync, nextPeriodEnd: null });
    expect(db.select().from(periods).get()).toMatchObject(sync);
  });

  it('fails without a period containing today', async () => {
    const db = await saveFinishedSetup();

    expect(() => changeStartDay(db, 1, 'own', '2027-06-01', 2_000)).toThrow('No period contains today');
  });
});

describe('setBigPurchaseSpread (BR-SET-05)', () => {
  it('saves the spread, pending sync at the next revision', async () => {
    const db = await saveFinishedSetup();

    setBigPurchaseSpread(db, 'wholePeriod', 2_000);

    expect(readSettings(db)).toMatchObject({
      bigPurchaseSpread: 'wholePeriod',
      updatedAt: 2_000,
      pending: true,
      localRev: 2,
    });
  });
});

describe('saveIncomes and saveFixedExpenses (BR-INC-01 to BR-INC-04)', () => {
  it('writes only what changed: an edit, a new item, and a removed one', async () => {
    const db = await saveFinishedSetup({
      incomes: [
        { name: 'Salary', amount: 640_808 },
        { name: 'Side job', amount: 30_000 },
      ],
    });
    const period = readPeriodOn(db, '2026-10-29')!;
    const [salary, side] = readPeriodItems(db, period.id)!.incomes;
    db.update(incomes).set({ pending: false }).run();

    saveIncomes(
      db,
      period.id,
      [
        { id: salary.id, name: 'Salary', amount: 650_000, note: null },
        { name: 'Bonus', amount: 0, note: null },
      ],
      2_000,
    );

    const rows = db.select().from(incomes).all();
    expect(rows.find((row) => row.id === salary.id)).toMatchObject({
      amount: 650_000,
      position: 0,
      pending: true,
      localRev: 2,
      updatedAt: 2_000,
    });
    expect(rows.find((row) => row.id === side.id)).toMatchObject({ deletedAt: 2_000, pending: true });
    // 0 keeps an item for a period it isn't paid in (BR-INC-04).
    expect(readPeriodItems(db, period.id)!.incomes).toEqual([
      { id: salary.id, name: 'Salary', amount: 650_000 },
      { id: expect.any(String), name: 'Bonus', amount: 0 },
    ]);
  });

  it('leaves an unchanged item alone', async () => {
    const db = await saveFinishedSetup();
    const period = readPeriodOn(db, '2026-10-29')!;
    const [rent] = readPeriodItems(db, period.id)!.fixedExpenses;
    db.update(fixedExpenses).set({ pending: false }).run();

    saveFixedExpenses(db, period.id, [{ ...rent }], 2_000);

    expect(db.select().from(fixedExpenses).get()).toMatchObject({ pending: false, localRev: 1 });
  });

  it('saves a fixed expense’s note', async () => {
    const db = await saveFinishedSetup();
    const period = readPeriodOn(db, '2026-10-29')!;
    const [rent] = readPeriodItems(db, period.id)!.fixedExpenses;

    saveFixedExpenses(db, period.id, [{ ...rent, note: 'Originally ¥130,000' }], 2_000);

    expect(readPeriodItems(db, period.id)!.fixedExpenses).toEqual([
      { ...rent, note: 'Originally ¥130,000' },
    ]);
  });

  it('changes only the period edited; the next period copies the edit (BR-INC-03)', async () => {
    const db = await saveFinishedSetup();
    const october = readPeriodOn(db, '2026-10-29')!;
    const [salary] = readPeriodItems(db, october.id)!.incomes;

    saveIncomes(db, october.id, [{ id: salary.id, name: 'Salary', amount: 700_000, note: null }], 2_000);
    ensureCurrentPeriod(db, '2026-11-25', 3_000);
    const november = readPeriodOn(db, '2026-11-25')!;
    const [copied] = readPeriodItems(db, november.id)!.incomes;
    saveIncomes(db, november.id, [{ id: copied.id, name: 'Salary', amount: 0, note: null }], 4_000);

    expect(readPeriodRecords(db, '2026-10-29')?.income).toEqual([700_000]);
    expect(readPeriodRecords(db, '2026-11-25')?.income).toEqual([0]);
  });
});

describe('saveSavingTarget (BR-TGT-01, BR-TGT-02)', () => {
  it.each([
    { name: 'changes the target', setupTarget: 100_000, amount: 80_000, localRev: 2 },
    { name: 'sets a target the period didn’t have', setupTarget: null, amount: 80_000, localRev: 1 },
    { name: 'clears it to 0 rather than deleting it', setupTarget: 100_000, amount: 0, localRev: 2 },
  ])('$name', async ({ setupTarget, amount, localRev }) => {
    const db = await saveFinishedSetup({ savingTarget: setupTarget });
    const period = readPeriodOn(db, '2026-10-29')!;

    saveSavingTarget(db, period.id, amount, 2_000);

    expect(readPeriodRecords(db, '2026-10-29')?.savingTarget).toBe(amount);
    expect(db.select().from(savingTargets).get()).toMatchObject({
      id: derivedId(period.id, 'saving-target'),
      deletedAt: null,
      pending: true,
      localRev,
    });
  });

  it('writes nothing when the target is the same', async () => {
    const db = await saveFinishedSetup();
    const period = readPeriodOn(db, '2026-10-29')!;
    db.update(savingTargets).set({ pending: false }).run();

    saveSavingTarget(db, period.id, 100_000, 2_000);

    expect(db.select().from(savingTargets).get()).toMatchObject({ pending: false, localRev: 1 });
  });
});

describe('readPeriodItems', () => {
  it('returns null for a period that doesn’t exist', async () => {
    const db = await saveFinishedSetup();

    expect(readPeriodItems(db, 'nope')).toBeNull();
  });
});

describe('updateExpense (BR-EXP-03, BR-EXP-05 to BR-EXP-07)', () => {
  it('saves every field, pending sync at the next revision', async () => {
    const db = await saveFinishedSetup();
    const id = spend(db, '2026-10-28', 1_000);
    db.update(expenses).set({ pending: false, syncError: 'invalid_row' }).run();
    const [, konbini] = readCategories(db);

    updateExpense(
      db,
      id,
      {
        amount: 1_500,
        categoryId: konbini.id,
        spentAt: new Date(2026, 9, 28, 12).getTime(),
        isBigPurchase: true,
        description: 'Gift',
      },
      3_000,
    );

    expect(readExpense(db, id)).toMatchObject({
      amount: 1_500,
      categoryId: konbini.id,
      isBigPurchase: true,
      description: 'Gift',
      date: '2026-10-28',
      updatedAt: 3_000,
      pending: true,
      syncError: null,
      localRev: 2,
    });
  });

  it('moves the expense to the period of its new date (BR-EXP-07)', async () => {
    const db = await saveFinishedSetup();
    ensureCurrentPeriod(db, '2026-11-25', 2_000);
    const id = spend(db, '2026-11-26', 1_000);
    const expense = readExpense(db, id)!;

    updateExpense(db, id, { ...expense, spentAt: new Date(2026, 9, 30, 9).getTime() }, 3_000);

    expect(readExpense(db, id)?.date).toBe('2026-10-30');
    expect(readPeriodExpenses(db, '2026-11-26')).toEqual([]);
    expect(readPeriodExpenses(db, '2026-10-29').map((e) => e.id)).toEqual([id]);
  });

  it('keeps the date when the time didn’t change, whatever the time zone now', async () => {
    const db = await saveFinishedSetup();
    const id = spend(db, '2026-10-28', 1_000);
    // As if recorded in another time zone, where that moment was the 27th.
    db.update(expenses).set({ date: '2026-10-27' }).run();
    const expense = readExpense(db, id)!;

    updateExpense(db, id, { ...expense, amount: 2_000 }, 3_000);

    expect(readExpense(db, id)?.date).toBe('2026-10-27');
  });
});

describe('deleteExpense and restoreExpense (BR-EXP-06)', () => {
  it('deletes the expense, keeping a marker for sync', async () => {
    const db = await saveFinishedSetup();
    const id = spend(db, '2026-10-28', 1_000);

    const deleted = deleteExpense(db, id, 3_000);

    expect(deleted).toMatchObject({ id, amount: 1_000 });
    expect(readExpense(db, id)).toBeNull();
    expect(readPeriodExpenses(db, '2026-10-29')).toEqual([]);
    expect(db.select().from(expenses).get()).toMatchObject({ deletedAt: 3_000, pending: true, localRev: 2 });
    expect(deleteExpense(db, id, 4_000)).toBeNull();
  });

  it('undoes a deletion by saving the expense again under a new ID', async () => {
    const db = await saveFinishedSetup();
    const id = spend(db, '2026-10-28', 1_000);
    const deleted = deleteExpense(db, id, 3_000)!;

    restoreExpense(db, deleted, 'restored', 4_000);

    expect(readPeriodExpenses(db, '2026-10-29')).toMatchObject([{ id: 'restored', amount: 1_000 }]);
    expect(readExpense(db, 'restored')).toMatchObject({
      date: '2026-10-28',
      spentAt: deleted.spentAt,
      pending: true,
      localRev: 1,
      updatedAt: 4_000,
    });
  });
});

describe('readCategory (BR-CAT-03)', () => {
  it('reads an archived category too', async () => {
    const db = await saveFinishedSetup();
    const [eatOut] = readCategories(db);
    db.update(categories).set({ archivedAt: 2_000 }).where(eq(categories.id, eatOut.id)).run();

    expect(readCategory(db, eatOut.id)).toEqual(eatOut);
    expect(readCategory(db, 'nope')).toBeNull();
  });
});

describe('readNeighbourPeriods (BR-HIS-01)', () => {
  it('finds the periods before and after one, and none past either end', async () => {
    const db = await saveFinishedSetup();
    ensureCurrentPeriod(db, '2026-12-30', 2_000);
    const [october, november, december] = ['2026-10-29', '2026-11-30', '2026-12-30'].map(
      (date) => readPeriodOn(db, date)!,
    );

    expect(readNeighbourPeriods(db, november)).toEqual({ previous: october, next: december });
    expect(readNeighbourPeriods(db, october)).toEqual({ previous: null, next: november });
    expect(readNeighbourPeriods(db, december)).toEqual({ previous: november, next: null });
  });
});

describe('extra income (BR-INC-06)', () => {
  /** Records extra income at noon on a date. */
  const receive = (db: Database, date: string, amount: number, description: string | null = null) => {
    const [year, month, day] = date.split('-').map(Number);
    const receivedAt = new Date(year, month - 1, day, 12).getTime();
    const id = newId();
    addExtraIncome(db, { amount, receivedAt, description }, id, 2_000);
    return id;
  };

  it('saves it dated by the device’s time zone, pending sync, and lists it newest first', async () => {
    const db = await saveFinishedSetup();

    const bonus = receive(db, '2026-10-27', 50_000, 'Bonus');
    const dinner = receive(db, '2026-10-28', 3_000);

    expect(readExtraIncome(db, bonus)).toMatchObject({
      amount: 50_000,
      date: '2026-10-27',
      description: 'Bonus',
      pending: true,
      localRev: 1,
    });
    expect(readPeriodExtraIncome(db, '2026-10-29')).toEqual([
      expect.objectContaining({ id: dinner, amount: 3_000, description: null, sync: 'pending' }),
      expect.objectContaining({ id: bonus, amount: 50_000, description: 'Bonus' }),
    ]);
    expect(readPeriodRecords(db, '2026-10-29')?.extraIncome).toEqual([
      { amount: 50_000, date: '2026-10-27' },
      { amount: 3_000, date: '2026-10-28' },
    ]);
    expect(readPeriodExtraIncome(db, '2027-06-01')).toEqual([]);
  });

  it('edits it, moving it to the period of a new date', async () => {
    const db = await saveFinishedSetup();
    ensureCurrentPeriod(db, '2026-11-25', 2_000);
    const id = receive(db, '2026-11-26', 3_000);

    updateExtraIncome(
      db,
      id,
      { amount: 4_000, receivedAt: new Date(2026, 9, 30, 9).getTime(), description: 'Refund' },
      3_000,
    );

    expect(readExtraIncome(db, id)).toMatchObject({
      amount: 4_000,
      date: '2026-10-30',
      description: 'Refund',
      localRev: 2,
    });
    expect(readPeriodExtraIncome(db, '2026-11-26')).toEqual([]);
  });

  it('deletes it, and undoing saves it again under a new ID', async () => {
    const db = await saveFinishedSetup();
    const id = receive(db, '2026-10-28', 3_000, 'Dinner');

    const deleted = deleteExtraIncome(db, id, 3_000)!;
    expect(readPeriodExtraIncome(db, '2026-10-29')).toEqual([]);
    expect(deleteExtraIncome(db, id, 3_500)).toBeNull();
    restoreExtraIncome(db, deleted, 'restored', 4_000);

    expect(readPeriodExtraIncome(db, '2026-10-29')).toMatchObject([
      { id: 'restored', amount: 3_000, description: 'Dinner' },
    ]);
  });
});
