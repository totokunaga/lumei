import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';

import { type CategorySpending, type ExpenseFilter, sameFilter } from '@/domain/spending';

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
 * expenses, one category's, or, always last, only the big purchases, in a
 * row that scrolls sideways. The selected chip is filled. Screen readers read each
 * as a button, with the selected one marked.
 */
export function ExpenseFilters({
  categories,
  hasBigPurchases,
  value,
  onChange,
}: ExpenseFiltersProps) {
  const { t } = useTranslation();
  const chips: { key: string; label: string; filter: ExpenseFilter }[] = [
    { key: 'all', label: t('spending.all'), filter: { kind: 'all' } },
    ...categories.map((category) => ({
      key: category.categoryId,
      label: `${category.emoji} ${category.name}`,
      filter: { kind: 'category', categoryId: category.categoryId } as const,
    })),
    ...(hasBigPurchases
      ? [
          {
            key: 'bigPurchases',
            label: t('spending.bigPurchases'),
            filter: { kind: 'bigPurchases' } as const,
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
      {chips.map((chip) => {
        const selected = sameFilter(chip.filter, value);
        return (
          <PressableScale
            key={chip.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(chip.filter)}
            className={`h-9 justify-center rounded-full px-4 ${
              selected ? 'bg-black dark:bg-white' : 'bg-gray-100 dark:bg-gray-900'
            }`}
          >
            <Text
              numberOfLines={1}
              className={`text-sm font-semibold ${
                selected ? 'text-white dark:text-black' : 'text-black dark:text-white'
              }`}
            >
              {chip.label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
