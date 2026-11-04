import { openUserDatabase } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import { countPendingChanges, readPeriodRecords, readSettings, saveSetup } from '@/db/records';
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
});
