import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, useColorScheme, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { Minor } from '@/domain/money';
import { formatShare, type SpendingByCategory } from '@/domain/spending';

import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';

/**
 * The categories' colors on the bar and beside their rows, by rank, the
 * largest first; the rest share gray. Each row also names its category, so
 * color isn't the only way to tell them apart.
 */
const PALETTE = {
  light: ['#10B981', '#0EA5E9', '#8B5CF6', '#F59E0B', '#F43F5E', '#14B8A6', '#6366F1', '#F97316'],
  dark: ['#34D399', '#38BDF8', '#A78BFA', '#FBBF24', '#FB7185', '#2DD4BF', '#818CF8', '#FB923C'],
} as const;
const REST = { light: '#9CA3AF', dark: '#6B7280' } as const;

const grow = { duration: 600, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** Props of `CategorySpending`. */
interface CategorySpendingProps {
  spending: SpendingByCategory;
  /** Formats an amount in the account currency, e.g. 2000 as "¥2,000". */
  money: (amount: Minor) => string;
  /** Shows the category's expenses in the list (BR-EXP-10). */
  onSelect: (categoryId: string) => void;
}

/**
 * Renders a period's spending by category (BR-HIS-04): its total, a bar split
 * by each category's share, which grows from the left on first show, and a
 * row per category with its emoji, name, share, and amount, the largest
 * first. It fills the height it is given, e.g. the chart's beside it: the
 * total and the bar stay put, and the rows scroll under them when they don't
 * all fit. Tapping a category filters the expense list to it. Each row reads as one button to
 * screen readers, e.g. "☕ Coffee: ¥3,000, 25%".
 */
export function CategorySpending({ spending, money, onSelect }: CategorySpendingProps) {
  const { t, i18n } = useTranslation();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const color = (rank: number) => PALETTE[scheme][rank] ?? REST[scheme];

  // The bar grows from the left the first time it shows.
  const reveal = useSharedValue(0);
  useEffect(() => {
    reveal.set(withTiming(1, grow));
  }, [reveal]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: reveal.get() }] }));

  return (
    <View className="flex-1 gap-4 rounded-3xl bg-gray-100 p-5 dark:bg-gray-900">
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={t('spending.heading', { amount: money(spending.total) })}
        className="flex-row items-baseline justify-between gap-4"
      >
        <Text className="text-base font-semibold text-black dark:text-white">
          {t('spending.title')}
        </Text>
        <Text className="text-base font-semibold text-gray-500 dark:text-gray-400">
          {money(spending.total)}
        </Text>
      </View>

      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[bar, { transformOrigin: 'left' }]}
        className="h-3 flex-row gap-0.5 overflow-hidden rounded-full"
      >
        {spending.categories.map((category, rank) => (
          <View
            key={category.categoryId}
            style={{ flex: category.amount, backgroundColor: color(rank) }}
          />
        ))}
      </Animated.View>

      {/* Inside the screen's list, so it scrolls on its own on Android too. */}
      <ScrollView
        nestedScrollEnabled
        persistentScrollbar
        className="-mb-5 flex-1"
        contentContainerClassName="gap-1 pb-5"
      >
        {spending.categories.map((category, rank) => {
          const share = formatShare(category.share, i18n.language);
          return (
            <PressableScale
              key={category.categoryId}
              accessibilityRole="button"
              accessibilityLabel={t('spending.row', {
                name: `${category.emoji} ${category.name}`,
                amount: money(category.amount),
                share,
              })}
              accessibilityHint={t('spending.rowHint')}
              onPress={() => onSelect(category.categoryId)}
              className="min-h-11 flex-row items-center gap-3"
            >
              <View style={{ backgroundColor: color(rank) }} className="h-2.5 w-2.5 rounded-full" />
              <Text className="text-lg">{category.emoji}</Text>
              <Text
                numberOfLines={1}
                className="flex-1 text-base font-medium text-black dark:text-white"
              >
                {category.name}
              </Text>
              <Text className="text-sm text-gray-500 dark:text-gray-400">{share}</Text>
              <Text className="min-w-20 text-right text-base font-semibold text-black dark:text-white">
                {money(category.amount)}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}
