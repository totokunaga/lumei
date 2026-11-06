// Deleting an expense (BR-EXP-06) or extra income (BR-INC-06) with a few
// seconds to undo it, from the edit sheet or by swiping its row.
import * as Haptics from 'expo-haptics';

import { database } from '@/db/client';
import { newId } from '@/db/ids';
import { deleteExpense, deleteExtraIncome, restoreExpense, restoreExtraIncome } from '@/db/records';

import { offerUndo } from './undo-banner';

/**
 * Deletes an expense, with a haptic, and shows the undo banner, which saves
 * it again as a new record (`restoreExpense`).
 * @param message What the banner says, e.g. "Expense deleted".
 * @returns False if the deletion couldn't be saved; nothing changed then.
 */
export const deleteExpenseWithUndo = (id: string, message: string): boolean => {
  let deleted;
  try {
    deleted = deleteExpense(database(), id, Date.now());
  } catch {
    return false;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  if (deleted) {
    const restorable = deleted;
    offerUndo({
      message,
      undo: () => restoreExpense(database(), restorable, newId(), Date.now()),
    });
  }
  return true;
};

/**
 * Deletes extra income, with a haptic, and shows the undo banner, which saves
 * it again as a new record (`restoreExtraIncome`).
 * @param message What the banner says, e.g. "Income deleted".
 * @returns False if the deletion couldn't be saved; nothing changed then.
 */
export const deleteIncomeWithUndo = (id: string, message: string): boolean => {
  let deleted;
  try {
    deleted = deleteExtraIncome(database(), id, Date.now());
  } catch {
    return false;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  if (deleted) {
    const restorable = deleted;
    offerUndo({
      message,
      undo: () => restoreExtraIncome(database(), restorable, newId(), Date.now()),
    });
  }
  return true;
};
