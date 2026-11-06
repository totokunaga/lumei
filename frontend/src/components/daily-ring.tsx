import { Canvas, Circle, Group, Path, Skia, vec } from '@shopify/react-native-skia';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, useColorScheme, View } from 'react-native';
import {
  cancelAnimation,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { allowanceUse } from '@/domain/expense';
import type { Minor } from '@/domain/money';
import { useScreenFocused } from '@/lib/use-screen-focused';

import { CountingText } from './counting-text';
import { EASE_IN_OUT, EASE_OUT, useReduceMotion } from './motion';

/** The canvas's side, with room around the ring for the dot's pulse, in points. */
const SIZE = 96;
const CENTER = SIZE / 2;
/** The ring's radius and thickness. */
const RADIUS = 32;
const STROKE = 8;
/** The dot at the arc's end, and how far its pulse grows. */
const DOT = 6;
const PING_REACH = 8;

const fillIn = { duration: 1500, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const move = { duration: 400, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System };
/** One radar ring around the dot, as on the chart: it grows and fades, eased, never bouncing. */
const ping = { duration: 1600, easing: EASE_OUT };

/** The ring's colors: the arc and dot follow the band of the allowance used (BR-DSH-01). */
const COLORS = {
  light: {
    low: '#10B981',
    high: '#F59E0B',
    critical: '#EF4444',
    track: 'rgba(0,0,0,0.08)',
    rim: '#FFFFFF',
  },
  dark: {
    low: '#34D399',
    high: '#FBBF24',
    critical: '#F87171',
    track: 'rgba(255,255,255,0.12)',
    rim: '#111827',
  },
} as const;

/** The text color of the share and of spent today for each band. */
const TEXT = {
  low: 'text-black dark:text-white',
  high: 'text-amber-700 dark:text-amber-300',
  critical: 'text-red-600 dark:text-red-400',
} as const;

/** The full circle the arc is trimmed from, starting at 3 o'clock; the group turns it to start at 12. */
const circle = (() => {
  const builder = Skia.PathBuilder.Make();
  builder.addCircle(CENTER, CENTER, RADIUS);
  return builder.detach();
})();

/** Props of `DailyRing` and `DailyAmounts`. */
interface DailyProps {
  spent: Minor;
  allowance: Minor;
  /** Formats an amount in the account currency, e.g. 2000 as "¥2,000". */
  money: (amount: Minor) => string;
}

/**
 * Works out how much of today's allowance is spent (BR-DSH-01).
 * @returns The share, 0–1 for the ring, which is full over the allowance or
 *   without one; and the share as written, e.g. "87%", or "–" without an
 *   allowance while the period is overspent.
 */
const shareOf = (spent: Minor, allowance: Minor, locale: string) => {
  if (allowance <= 0) {
    return { fill: 1, text: '–' };
  }
  const share = spent / allowance;
  return {
    fill: Math.min(1, Math.max(0, share)),
    text: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
      share,
    ),
  };
};

/**
 * Renders today's spending against the daily allowance as a ring
 * (BR-DSH-01): the arc fills clockwise from the top toward the allowance,
 * with a dot at its end carrying a radar pulse, as the chart's today dot
 * does, and the share spent in its center. It is green below 65% of the
 * allowance, amber from 65%, and red from 80%. Over the allowance, or without
 * one while the period is overspent, the ring is full and red (BR-DSH-02).
 * On first show the arc fills from empty; later changes move it to the new
 * share. With Reduce Motion it is in place at once, without the pulse,
 * which also pauses while the screen isn't in front. It reads as one element
 * to screen readers, e.g. "Spent today: ¥2,000, Daily allowance: ¥6,000, 33%"
 * (BR-NFR-07).
 */
export function DailyRing({ spent, allowance, money }: DailyProps) {
  const { t, i18n } = useTranslation();
  const colors = COLORS[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const reduceMotion = useReduceMotion();
  const focused = useScreenFocused();
  const use = allowanceUse(spent, allowance);
  const accent = colors[use];
  const share = shareOf(spent, allowance, i18n.language);

  // How much of the ring is filled, 0–1; it fills from empty the first time.
  const filled = useSharedValue(0);
  const shown = useRef(false);
  useEffect(() => {
    filled.set(withTiming(share.fill, shown.current ? move : fillIn));
    shown.current = true;
  }, [share.fill, filled]);

  const pulsing = focused && !reduceMotion;
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (pulsing) {
      pulse.set(0);
      pulse.set(withRepeat(withTiming(1, ping), -1, false));
    } else {
      cancelAnimation(pulse);
      pulse.set(0);
    }
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse]);

  // The dot sits at the arc's end, clockwise from 12 o'clock.
  const dotX = useDerivedValue(
    () => CENTER + RADIUS * Math.cos(2 * Math.PI * filled.get() - Math.PI / 2),
  );
  const dotY = useDerivedValue(
    () => CENTER + RADIUS * Math.sin(2 * Math.PI * filled.get() - Math.PI / 2),
  );
  const pulseRadius = useDerivedValue(() => DOT + pulse.get() * PING_REACH);
  const pulseOpacity = useDerivedValue(() => (1 - pulse.get()) * 0.6);

  return (
    <View
      accessible
      accessibilityLabel={`${t('home.pair', {
        first: t('home.labelled', { label: t('home.spentToday'), value: money(spent) }),
        second: t('home.labelled', { label: t('home.allowance'), value: money(allowance) }),
      })}, ${share.text}`}
      style={{ width: SIZE, height: SIZE }}
      className="items-center justify-center"
    >
      <Canvas style={{ position: 'absolute', width: SIZE, height: SIZE }}>
        <Circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          color={colors.track}
          style="stroke"
          strokeWidth={STROKE}
        />
        <Group transform={[{ rotate: -Math.PI / 2 }]} origin={vec(CENTER, CENTER)}>
          <Path
            path={circle}
            color={accent}
            style="stroke"
            strokeWidth={STROKE}
            strokeCap="round"
            end={filled}
          />
        </Group>
        {pulsing && (
          <Circle
            cx={dotX}
            cy={dotY}
            r={pulseRadius}
            color={accent}
            style="stroke"
            strokeWidth={2}
            opacity={pulseOpacity}
          />
        )}
        <Circle cx={dotX} cy={dotY} r={DOT} color={colors.rim} />
        <Circle cx={dotX} cy={dotY} r={DOT - 2} color={accent} />
      </Canvas>
      <Text className={`text-base font-bold ${TEXT[use]}`}>{share.text}</Text>
    </View>
  );
}

/**
 * Renders spent today against the daily allowance under the hero, as
 * "¥2,000 / ¥6,000" under "Spent today / Daily allowance", each counting to
 * its new value; spent today turns red over the allowance (BR-DSH-02).
 * Screen readers skip it: `DailyRing` reads both amounts.
 */
export function DailyAmounts({ spent, allowance, money }: DailyProps) {
  const { t } = useTranslation();
  const use = allowanceUse(spent, allowance);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="gap-0.5"
    >
      <Text className="text-sm text-gray-600 dark:text-gray-400">{t('home.spentOfAllowance')}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        className="text-2xl font-normal text-black dark:text-white"
      >
        <CountingText
          value={spent}
          format={money}
          className={use === 'low' ? undefined : TEXT[use]}
        />
        <Text className="text-gray-500 dark:text-gray-400">
          {' / '}
          <CountingText value={allowance} format={money} />
        </Text>
      </Text>
    </View>
  );
}
