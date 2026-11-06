// Deleting an expense with a few seconds to undo it (BR-EXP-06), from the
// edit sheet or by swiping its row.
import * as Haptics from 'expo-haptics';

import { database } from '@/db/client';
import { newId } from '@/db/ids';
import { deleteExpense, restoreExpense } from '@/db/records';

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
