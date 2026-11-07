// Connects the account to the "Add Expense" shortcut on iOS (BR-EXP-12). The
// shortcut writes into the account's database itself, while the app's
// JavaScript may not be running; see `modules/expense-shortcut/`.
import { useEffect } from 'react';

import { notifyChange } from '@/db/changes';
import { database } from '@/db/client';
import { databaseFileName } from '@/db/file-name';
import { readSettings } from '@/db/records';
import { CURRENCIES, isCurrencyCode } from '@/domain/money';

import { ExpenseShortcut } from '../../modules/expense-shortcut';

/**
 * While `userId`'s database is open and its setup has finished, lets the
 * shortcut record into it, and shows each expense the shortcut saves as soon
 * as it does, then syncs it, as if the user had saved it in the app
 * (BR-DSH-04, BR-OFF-03). The account stays shared after the app closes, so
 * the shortcut works without opening it, until `forgetShortcutAccount()`.
 * Without the native module (Android, Expo Go), it does nothing.
 * @param userId The signed-in account, or null while there is none ready.
 */
export const useExpenseShortcut = (userId: string | null): void => {
  useEffect(() => {
    if (!ExpenseShortcut || !userId) {
      return;
    }
    const currency = readSettings(database())?.currency;
    if (!currency || !isCurrencyCode(currency)) {
      return;
    }
    ExpenseShortcut.shareAccount(databaseFileName(userId), currency, CURRENCIES[currency]);
    const subscription = ExpenseShortcut.addListener('onExpenseAdded', () => notifyChange());
    return () => subscription.remove();
  }, [userId]);
};

/** Stops the shortcut recording into the account, e.g. on sign-out (BR-ACC-04). */
export const forgetShortcutAccount = (): void => {
  ExpenseShortcut?.forgetAccount();
};
