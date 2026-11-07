import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { CategoryForm } from '@/components/category-form';
import { database } from '@/db/client';
import { readManagedCategory } from '@/db/records';

/**
 * Renders the sheet that edits, archives, or unarchives a category
 * (BR-CAT-02, BR-CAT-03), opened by tapping it on the Categories screen. It
 * shows nothing for a category that no longer exists.
 */
export default function EditCategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Read once: the form edits the category as it was when the sheet opened.
  const category = useMemo(() => readManagedCategory(database(), id), [id]);
  return category ? <CategoryForm category={category} /> : null;
}
