// An account that has finished setup, as if set up in an earlier session.
import { closeUserDatabase, openUserDatabase } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import { saveSetup } from '@/db/records';
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
