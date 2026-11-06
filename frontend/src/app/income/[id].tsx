import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { IncomeForm } from '@/components/income-form';
import { database } from '@/db/client';
import { readExtraIncome } from '@/db/records';

/**
 * Renders the sheet that edits or deletes extra income (BR-INC-06), opened
 * by tapping it in the home screen's list. It shows nothing for income that
 * no longer exists, e.g. deleted on another device.
 */
export default function EditIncomeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Read once: the form edits the income as it was when the sheet opened.
  const income = useMemo(() => readExtraIncome(database(), id), [id]);
  return income ? <IncomeForm income={income} /> : null;
}
