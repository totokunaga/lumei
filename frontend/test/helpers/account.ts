// An account that has finished setup, as if set up in an earlier session.
import { eq } from 'drizzle-orm';

import { closeUserDatabase, openUserDatabase } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import { addExpense, readCategories, saveSetup } from '@/db/records';
import { expenses as expensesTable, syncedTables } from '@/db/schema';
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
 * session would have, not synced yet. Call it after `finishedSetup`.
 * @returns The expenses' IDs, in order.
 */
export const savedExpenses = async (
  expenses: ExpenseFixture[],
  userId: string = testUser.id,
): Promise<string[]> => {
  const db = await openUserDatabase(userId);
  const [category] = readCategories(db);
  const ids: string[] = [];
  for (const { amount, date, isBigPurchase = false } of expenses) {
    const [year, month, day] = date.split('-').map(Number);
    const spentAt = new Date(year, month - 1, day, 12).getTime();
    const id = newId();
    addExpense(db, { amount, categoryId: category.id, spentAt, isBigPurchase }, id, spentAt);
    ids.push(id);
  }
  closeUserDatabase();
  return ids;
};

/**
 * Marks every record in the account's database as synced, as after a sync
 * the API confirmed, and closes it. A record whose sync failed keeps that
 * state only if `failedId` names it.
 */
export const syncedRecords = async (
  { failedId }: { failedId?: string } = {},
  userId: string = testUser.id,
): Promise<void> => {
  const db = await openUserDatabase(userId);
  for (const table of syncedTables) {
    db.update(table).set({ pending: false }).run();
  }
  if (failedId) {
    db.update(expensesTable)
      .set({ pending: true, syncError: 'invalid_row' })
      .where(eq(expensesTable.id, failedId))
      .run();
  }
  closeUserDatabase();
};
