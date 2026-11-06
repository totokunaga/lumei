import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { ExpenseForm } from '@/components/expense-form';
import { database } from '@/db/client';
import { readExpense } from '@/db/records';

/**
 * Renders the sheet that edits or deletes an expense (BR-EXP-03 to
 * BR-EXP-07), opened by tapping it in a list. It shows nothing for an
 * expense that no longer exists, e.g. one another device deleted.
 */
export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Read once: the form edits the expense as it was when the sheet opened.
  const expense = useMemo(() => readExpense(database(), id), [id]);
  return expense ? <ExpenseForm expense={expense} /> : null;
}
