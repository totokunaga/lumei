import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect } from 'react';
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

import type { AllowanceUse } from '@/domain/expense';
import type { Minor } from '@/domain/money';

import { CountingText } from './counting-text';
import { type AllowanceLabels, DailyAmounts, DailyRing } from './daily-ring';
import { EASE_OUT, listLayout } from './motion';
import { PressableScale } from './pressable-scale';

const shift = { duration: 300, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const turn = { duration: 250, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const fadeIn = FadeIn.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System);
const fadeOut = FadeOut.duration(150).easing(EASE_OUT).reduceMotion(ReduceMotion.System);

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

/** Props of `StatusCard`. */
export interface StatusCardProps {
  /** The most prominent number and its label, e.g. "Remaining this week (4 days)" and ¥20,480. */
  hero: { label: string; value: Minor };
  /**
   * Changes when the hero starts showing another number, e.g. the period's
   * overspend instead of what is left, so it doesn't count from one to the other.
   */
  heroKey: string;
  /** What was spent against what is allowed, shown as amounts and as a ring. */
  spent: Minor;
  allowance: Minor;
  labels: AllowanceLabels;
  /** The band of the allowance used, which colors the card (BR-DSH-01). */
  use: AllowanceUse;
  /** Formats an amount in the account currency, e.g. 4865 as "¥4,865". */
  money: (amount: Minor) => string;
  /**
   * What the card expands to, with its toggle's name; without it, the card
   * doesn't expand.
   */
  details?: { label: string; content: ReactNode; expanded: boolean; onToggle: () => void };
}

/**
 * Renders one of the home screen's status cards (BR-DSH-01, BR-DSH-07): the
 * hero number, and what was
 * spent against what is allowed, as amounts and as a ring (`DailyRing`). The
 * hero shows below 0 as a negative amount, e.g. "-¥1,200" (BR-DSH-02). Each
 * amount counts to its new value, and the card eases between green, amber,
 * and red with `use`.
 *
 * Given `details`, a chevron at the top right expands it, as does tapping the
 * card; the details fade in and out as the card resizes. Each number reads
 * as one element to screen readers, with its settled value, and the chevron
 * is the toggle they use (BR-NFR-07).
 */
export function StatusCard({
  hero,
  heroKey,
  spent,
  allowance,
  labels,
  use,
  money,
  details,
}: StatusCardProps) {
  const { t } = useTranslation();
  const expanded = details?.expanded ?? false;
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.set(withTiming(expanded ? 180 : 0, turn));
  }, [expanded, rotation]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));
  const dark = useColorScheme() === 'dark';
  const progress = useSharedValue<number>(BAND[use]);

  useEffect(() => {
    progress.set(withTiming(BAND[use], shift));
  }, [use, progress]);

  const fill = dark ? FILL.dark : FILL.light;
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1, 2], [...fill]),
  }));
  const accent = ACCENT[use];

  return (
    <Animated.View layout={listLayout} style={style} className="grow overflow-hidden rounded-3xl">
      {/* The whole card toggles for a tap; screen readers use the chevron's button instead. */}
      <Pressable
        accessible={false}
        disabled={!details}
        onPress={details?.onToggle}
        className="grow gap-3 p-6"
      >
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
              <CountingText
                key={heroKey}
                value={hero.value}
                format={money}
                adjustsFontSizeToFit
                numberOfLines={1}
                className={`text-6xl font-bold ${accent}`}
              />
            </View>
            <DailyAmounts spent={spent} allowance={allowance} money={money} labels={labels} />
          </View>
          {/* The chevron at the top right, level with the hero's label, and the ring under it.
              A card without one keeps its space, so the rings line up across the cards. */}
          <View className="items-end">
            {details ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={details.label}
                accessibilityState={{ expanded }}
                hitSlop={12}
                onPress={details.onToggle}
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
            ) : (
              <View className="h-5 w-5" />
            )}
            <View className="-mr-3 -mt-2">
              <DailyRing spent={spent} allowance={allowance} money={money} labels={labels} />
            </View>
          </View>
        </View>

        {details && expanded && (
          <Animated.View entering={fadeIn} exiting={fadeOut}>
            {details.content}
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}
