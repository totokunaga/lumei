import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { PeriodSummary, TodayStatus } from '@/domain/calculations';
import { isOverToday } from '@/domain/expense';
import type { Minor } from '@/domain/money';

import { CountingText } from './counting-text';
import { EASE_OUT, listLayout } from './motion';
import { PressableScale } from './pressable-scale';
import { type EditableItem, type SummaryRow, SummaryRows } from './summary-rows';

const shift = { duration: 300, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const turn = { duration: 250, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const fadeIn = FadeIn.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const fadeOut = FadeOut.duration(150).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

/** The card's fill: emerald-50 or red-50, and emerald-950 or red-950 in dark mode. */
const FILL = { light: ['#ECFDF5', '#FEF2F2'], dark: ['#022C22', '#450A0A'] } as const;

/** Props of `TodayCard`. */
interface TodayCardProps {
  status: TodayStatus;
  /** The period's totals, shown when the card is expanded (BR-DSH-03). */
  summary: PeriodSummary;
  /** Formats an amount in the account currency, e.g. 4865 as "¥4,865". */
  money: (amount: Minor) => string;
  /** Opens the editor of the period's income, fixed expenses, or saving target (BR-INC-01, BR-TGT-01). */
  onEdit: (item: EditableItem) => void;
}

/**
 * Renders today's numbers (BR-DSH-01, BR-DSH-02): remaining today as the hero,
 * with spent today against the daily allowance under it, and the period's
 * budget left (BR-CALC-08) beside them. Remaining today and the budget left
 * below 0 show as negative amounts in red, e.g. "-¥1,200". While the whole
 * period is overspent, the allowance shows 0 and the period's overspend
 * becomes the hero, as a negative amount under "Over for this period". Each
 * amount counts to its new value, and the card eases from green to red as
 * today goes over.
 *
 * It starts collapsed. Tapping the card, or the chevron at its top right,
 * expands it to the period summary under today's numbers (BR-DSH-03):
 * planned and extra income, fixed expenses, the saving target, big purchases, spending to date,
 * and the days left. The rows fade in and out as the card resizes. Income,
 * fixed expenses, and the saving target open their editor. Each
 * number reads as one element to screen readers, with its settled value, and
 * the chevron is the toggle they use
 * (BR-NFR-07).
 */
export function TodayCard({ status, summary, money, onEdit }: TodayCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.set(withTiming(expanded ? 180 : 0, turn));
  }, [expanded, rotation]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));
  const toggle = () => setExpanded((open) => !open);
  const dark = useColorScheme() === 'dark';
  const over = isOverToday(status);
  const progress = useSharedValue(over ? 1 : 0);

  useEffect(() => {
    progress.set(withTiming(over ? 1 : 0, shift));
  }, [over, progress]);

  const fill = dark ? FILL.dark : FILL.light;
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [fill[0], fill[1]]),
  }));

  // Below 0, remaining today and the period's overspend show as negative amounts (BR-DSH-02).
  const mode: 'periodOver' | 'remaining' = status.periodOverspend > 0 ? 'periodOver' : 'remaining';
  const hero =
    mode === 'periodOver'
      ? { label: t('home.periodOver'), value: -status.periodOverspend }
      : { label: t('home.remainingToday'), value: status.remainingToday ?? 0 };
  const accent = over ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300';

  // Budget left shows next to today's numbers, so it isn't among the details.
  const budgetLeft = {
    label: t('home.budgetLeft'),
    value: summary.budgetLeft,
    format: money,
  };
  const details: SummaryRow[] = [
    { label: t('home.income'), value: summary.income, format: money, edit: 'income' },
    { label: t('home.extraIncome'), value: summary.extraIncome, format: money },
    {
      label: t('home.fixedExpenses'),
      value: summary.fixedExpenses,
      format: money,
      edit: 'fixed-expenses',
    },
    { label: t('home.savingTarget'), value: summary.savingTarget, format: money, edit: 'target' },
    { label: t('home.bigPurchases'), value: summary.bigPurchases, format: money },
    { label: t('home.spentToDate'), value: summary.spentToDate, format: money },
    {
      label: t('home.daysLeftLabel'),
      value: summary.daysLeft,
      format: (count) => t('home.daysLeft', { count }),
    },
  ];

  return (
    <Animated.View layout={listLayout} style={style} className="overflow-hidden rounded-3xl">
      {/* The whole card toggles for a tap; screen readers use the chevron's button instead. */}
      <Pressable accessible={false} onPress={toggle} className="gap-3 p-6">
        <View className="flex-row items-start gap-3">
          <View
            accessible
            accessibilityLabel={t('home.labelled', {
              label: hero.label,
              value: money(hero.value),
            })}
            className="flex-1 gap-1"
          >
            <Text className={`text-sm font-medium uppercase ${accent}`}>{hero.label}</Text>
            {/* Keyed by mode, so it doesn't count from remaining today to the period's overspend. */}
            <CountingText
              key={mode}
              value={hero.value}
              format={money}
              adjustsFontSizeToFit
              numberOfLines={1}
              className={`text-6xl font-bold ${accent}`}
            />
          </View>
          {/* Top right, level with the hero's label. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('home.periodDetails')}
            accessibilityState={{ expanded }}
            hitSlop={12}
            onPress={toggle}
            className="h-5 w-5 items-center justify-center"
          >
            <Animated.View style={chevron}>
              <SymbolView
                name={{ ios: 'chevron.down', android: 'expand_more' }}
                size={16}
                weight="semibold"
                tintColor="#9CA3AF"
                style={{ width: 16, height: 16 }}
              />
            </Animated.View>
          </PressableScale>
        </View>
        <View className="flex-row items-end justify-between gap-4">
          <View className="flex-shrink">
            <SpentOfAllowance
              spent={status.spentToday}
              allowance={status.allowance}
              money={money}
            />
          </View>
          <View
            accessible
            accessibilityLabel={t('home.labelled', {
              label: budgetLeft.label,
              value: budgetLeft.format(budgetLeft.value),
            })}
            className="items-end gap-0.5"
          >
            <Text className="text-sm text-gray-600 dark:text-gray-400">{budgetLeft.label}</Text>
            <CountingText
              value={budgetLeft.value}
              format={budgetLeft.format}
              numberOfLines={1}
              adjustsFontSizeToFit
              className={`text-2xl font-normal ${
                budgetLeft.value < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-black dark:text-white'
              }`}
            />
          </View>
        </View>

        {expanded && (
          <Animated.View entering={fadeIn} exiting={fadeOut}>
            <SummaryRows rows={details} onEdit={onEdit} />
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Renders spent today against the daily allowance on one line, e.g. "¥2,000 /
 * ¥6,000" under "Spent today / Daily allowance", each counting to its new
 * value. It reads as one element to screen readers, e.g. "Spent today:
 * ¥2,000, Daily allowance: ¥6,000" (BR-NFR-07).
 */
function SpentOfAllowance({
  spent,
  allowance,
  money,
}: {
  spent: Minor;
  allowance: Minor;
  money: (amount: Minor) => string;
}) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t('home.pair', {
        first: t('home.labelled', { label: t('home.spentToday'), value: money(spent) }),
        second: t('home.labelled', { label: t('home.allowance'), value: money(allowance) }),
      })}
      className="gap-0.5"
    >
      <Text className="text-sm text-gray-600 dark:text-gray-400">{t('home.spentOfAllowance')}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className="text-2xl font-normal text-black dark:text-white"
      >
        <CountingText value={spent} format={money} />
        <Text className="text-gray-500 dark:text-gray-400">
          {' / '}
          <CountingText value={allowance} format={money} />
        </Text>
      </Text>
    </View>
  );
}
