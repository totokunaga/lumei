import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';

import {
  type CategorySpending,
  type ExpenseFilter,
  type FilterChip,
  isChipSelected,
  toggleChip,
} from '@/domain/spending';

import { PressableScale } from './pressable-scale';

/** Props of `ExpenseFilters`. */
interface ExpenseFiltersProps {
  /** The categories with expenses in the period, in the order shown. */
  categories: readonly Pick<CategorySpending, 'categoryId' | 'name' | 'emoji'>[];
  /** Whether the period has a big purchase, so the "Big purchases" chip shows. */
  hasBigPurchases: boolean;
  value: ExpenseFilter;
  onChange: (filter: ExpenseFilter) => void;
}

/**
 * Renders the chips that filter a period's expense list (BR-EXP-10): all
 * expenses, those of any categories chosen, or, always last, only the big
 * purchases, in a row that scrolls sideways. Categories toggle on and off
 * together; "All" clears them. Selected chips are a soft slate gray with an outline.
 * Screen readers read each as a button, with the selected ones marked.
 */
export function ExpenseFilters({
  categories,
  hasBigPurchases,
  value,
  onChange,
}: ExpenseFiltersProps) {
  const { t } = useTranslation();
  const chips: { key: string; label: string; chip: FilterChip }[] = [
    { key: 'all', label: t('spending.all'), chip: { kind: 'all' } },
    ...categories.map((category) => ({
      key: category.categoryId,
      label: `${category.emoji} ${category.name}`,
      chip: { kind: 'category', categoryId: category.categoryId } as const,
    })),
    ...(hasBigPurchases
      ? [
          {
            key: 'bigPurchases',
            label: t('spending.bigPurchases'),
            chip: { kind: 'bigPurchases' } as const,
          },
        ]
      : []),
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('spending.filter')}
      // Edge to edge, past the list's side padding, while the chips line up with it.
      className="-mx-6"
      contentContainerClassName="gap-2 px-6"
    >
      {chips.map(({ key, label, chip }) => {
        const selected = isChipSelected(value, chip);
        return (
          <PressableScale
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(toggleChip(value, chip))}
            className={`h-9 justify-center rounded-full border px-4 ${
              selected
                ? 'border-slate-400 bg-slate-200 dark:border-slate-500 dark:bg-slate-700'
                : 'border-transparent bg-gray-100 dark:bg-gray-900'
            }`}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-semibold ${
                selected ? 'text-slate-900 dark:text-white' : 'text-black dark:text-white'
              }`}
            >
              {label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
