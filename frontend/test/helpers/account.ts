// An account that has finished setup, as if set up in an earlier session.
import { closeUserDatabase, openUserDatabase } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import { addExpense, readCategories, saveSetup } from '@/db/records';
import { localToday } from '@/domain/date';
import { buildSetupRecords, type SetupChoices } from '@/domain/setup';

import { testUser } from './api';
import { japanSet } from './category-sets';

/** The choices `finishedSetup` saves unless overridden: Japan, yen, calendar months. */
export const setupChoices: SetupChoices = {
  set: japanSet,
  currency: 'JPY',
  periodStartDay: 1,
  incomes: [{ name: 'Salary', amount: 300_000 }],
  fixedExpenses: [{ name: 'House Rent', amount: 100_000, note: null }],
  savingTarget: 50_000,
};

/**
 * Saves a finished setup in the account's database and closes it, as an
 * earlier session would have left it. With the defaults, the spending budget
 * is ¥150,000.
 */
export const finishedSetup = async (
  overrides: Partial<SetupChoices> = {},
  userId: string = testUser.id,
): Promise<void> => {
  const db = await openUserDatabase(userId);
  const now = Date.now();
  saveSetup(
    db,
    buildSetupRecords(
      { ...setupChoices, ...overrides },
      { userId, language: 'en', today: localToday(), now, ids: { newId, derivedId } },
    ),
    now,
  );
  closeUserDatabase();
};

/** An expense as `savedExpenses` takes it: on a date, at noon, in the first category unless set. */
export interface ExpenseFixture {
  amount: number;
  date: string;
  isBigPurchase?: boolean;
}

/**
 * Saves expenses in the account's database and closes it, as an earlier
 * session would have. Call it after `finishedSetup`.
 */
export const savedExpenses = async (
  expenses: ExpenseFixture[],
  userId: string = testUser.id,
): Promise<void> => {
  const db = await openUserDatabase(userId);
  const [category] = readCategories(db);
  for (const { amount, date, isBigPurchase = false } of expenses) {
    const [year, month, day] = date.split('-').map(Number);
    const spentAt = new Date(year, month - 1, day, 12).getTime();
    addExpense(db, { amount, categoryId: category.id, spentAt, isBigPurchase }, newId(), spentAt);
  }
  closeUserDatabase();
};
