// Confirms setup: saves the account's first records and opens the home screen
// (BR-ACC-06).
import { useAuth } from '@/auth/store';
import { database } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import { saveSetup } from '@/db/records';
import { useLocalData } from '@/db/store';
import { localToday } from '@/domain/date';
import { buildSetupRecords } from '@/domain/setup';
import { currentLanguage } from '@/i18n';

import { useSetupDraft } from './draft';

/**
 * Saves the setup choices as the account's first records, in one
 * transaction, then lets the user through to the home screen. The default
 * categories are named in the app's language now (BR-CAT-06).
 * @throws If the region or currency hasn't been chosen, or the database write
 *   fails; nothing is saved then.
 */
export const finishSetup = (): void => {
  const { set, currency, periodStartDay, incomes, fixedExpenses, savingTarget, reset } =
    useSetupDraft.getState();
  const userId = useAuth.getState().session?.user.id;
  if (!set || !currency || !userId) {
    throw new Error('Setup needs a signed-in user, a region, and a currency');
  }

  const now = Date.now();
  const records = buildSetupRecords(
    { set, currency, periodStartDay, incomes, fixedExpenses, savingTarget },
    { userId, language: currentLanguage(), today: localToday(), now, ids: { newId, derivedId } },
  );
  saveSetup(database(), records, now);
  reset();
  useLocalData.getState().completeSetup();
};
