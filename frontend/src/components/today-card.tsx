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
import { todayUse } from '@/domain/expense';
import type { Minor } from '@/domain/money';

import { CountingText } from './counting-text';
import { DailyAmounts, DailyRing } from './daily-ring';
import { EASE_OUT, listLayout } from './motion';
import { PressableScale } from './pressable-scale';
import { type EditableItem, type SummaryRow, SummaryRows } from './summary-rows';

const shift = { duration: 300, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const turn = { duration: 250, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const fadeIn = FadeIn.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const fadeOut = FadeOut.duration(150).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

/** The card's fill: emerald-50 or red-50, and emerald-950 or red-950 in dark mode. */
/**
 * The card's fill for each band of the allowance used (BR-DSH-01): emerald,
 * amber, and red, 50 in light mode and 950 in dark mode.
 */
const FILL = {
  light: ['#ECFDF5', '#FFFBEB', '#FEF2F2'],
  dark: ['#022C22', '#451A03', '#450A0A'],
} as const;

/** The band's place in `FILL`, which the fill eases between. */
const BAND = { low: 0, high: 1, critical: 2 } as const;

/** The hero's color for each band. */
const ACCENT = {
  low: 'text-emerald-700 dark:text-emerald-300',
  high: 'text-amber-700 dark:text-amber-300',
  critical: 'text-red-600 dark:text-red-400',
} as const;

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
 * with today's spending against the daily allowance beside it as a ring
 * (`DailyRing`) and under it as amounts (`DailyAmounts`). Remaining today below 0 shows as a negative amount in
 * red, e.g. "-¥1,200". While the whole period is overspent, the allowance
 * shows 0 and the period's overspend becomes the hero, as a negative amount
 * under "Over for this period". Each amount counts to its new value, and the
 * card eases between green, amber, and red as today's allowance is used:
 * below 65%, from 65%, and from 80% (BR-DSH-01).
 *
 * It starts collapsed. Tapping the card, or the chevron at its top right,
 * expands it to the period summary (BR-DSH-03): planned and extra income,
 * fixed expenses, the saving target, big purchases, spending to date, the
 * budget left (BR-CALC-08), and the days left. The rows fade in and out as
 * the card resizes. Income, fixed expenses, and the target open their
 * editor. Each number reads as one element to screen readers, with its
 * settled value, and the chevron is the toggle they use (BR-NFR-07).
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
  // Over the allowance, or with the period overspent, counts as critical too.
  const use = todayUse(status);
  const progress = useSharedValue<number>(BAND[use]);

  useEffect(() => {
    progress.set(withTiming(BAND[use], shift));
  }, [use, progress]);

  const fill = dark ? FILL.dark : FILL.light;
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1, 2], [...fill]),
  }));

  // Below 0, remaining today and the period's overspend show as negative amounts (BR-DSH-02).
  const mode: 'periodOver' | 'remaining' = status.periodOverspend > 0 ? 'periodOver' : 'remaining';
  const hero =
    mode === 'periodOver'
      ? { label: t('home.periodOver'), value: -status.periodOverspend }
      : { label: t('home.remainingToday'), value: status.remainingToday ?? 0 };
  const accent = ACCENT[use];

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
    // Budget left goes negative, in red, once the period is overspent (BR-DSH-02).
    { label: t('home.budgetLeft'), value: summary.budgetLeft, format: money },
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
          <View className="flex-1 gap-2">
            <View
              accessible
              accessibilityLabel={t('home.labelled', {
                label: hero.label,
                value: money(hero.value),
              })}
              className="gap-1"
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
            <DailyAmounts spent={status.spentToday} allowance={status.allowance} money={money} />
          </View>
          {/* The chevron at the top right, level with the hero's label, and today's ring under it. */}
          <View className="items-end">
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
            <View className="-mr-3 -mt-2">
              <DailyRing spent={status.spentToday} allowance={status.allowance} money={money} />
            </View>
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
