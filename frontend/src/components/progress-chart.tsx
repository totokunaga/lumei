import { Canvas, Circle, DashPathEffect, Line, Path, Skia, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { ProgressChart as ChartData } from '@/domain/calculations';
import type { Minor } from '@/domain/money';
import { limitUse } from '@/domain/expense';
import { formatShortDate } from '@/domain/period';
import { type ChartView, useChartView } from '@/lib/chart-view';
import { useScreenFocused } from '@/lib/use-screen-focused';

import { chartGeometry, RECENT_DAYS, recentDays } from './chart-geometry';
import { EASE_IN_OUT, EASE_OUT, useReduceMotion } from './motion';

/** The canvas's height, in points. */
const HEIGHT = 150;

/**
 * Roughly how wide today's amount is, inside the chart against its amount
 * axis: if the dot is closer than that to the axis, the amount moves to the
 * dot's right instead, so it never covers it.
 */
const AMOUNT_WIDTH = 72;

/** The width of the date under today's dot, which keeps the period's first and last dates clear. */
const DATE_WIDTH = 56;

/**
 * The series' colors in light and dark mode; shapes tell them apart too
 * (BR-CHT-05). In each band, the spending line, today's dot, and the axis
 * labels take the heading's deeper shade, and the bars a brighter one, so
 * both stand out on the gray card.
 */
const COLORS = {
  light: {
    limit: '#9CA3AF',
    // Emerald 600, amber 600, and red 600, as the heading's text.
    line: { low: '#059669', high: '#D97706', critical: '#DC2626' },
    // Emerald 400, amber 400, and red 300: red's bars a step lighter, so the
    // line stands apart from them.
    bar: { low: '#34D399', high: '#FBBF24', critical: '#FCA5A5' },
    ring: '#FFFFFF',
    axis: '#D1D5DB',
  },
  dark: {
    limit: '#6B7280',
    // Emerald 300, amber 300, and red 400, as the heading's text in dark mode.
    line: { low: '#6EE7B7', high: '#FCD34D', critical: '#F87171' },
    // Emerald 400, amber 400, and red 500, each apart from the line's shade.
    bar: { low: '#34D399', high: '#FBBF24', critical: '#EF4444' },
    ring: '#111827',
    axis: '#374151',
  },
} as const;

const drawIn = { duration: 1500, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const morph = { duration: 400, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System };
/** Switching views draws the chart in again, quicker than on first show. */
const redraw = { duration: 700, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** One radar ring around today's dot: it grows from the dot and fades out, eased, never bouncing. */
const ping = { duration: 1600, easing: EASE_OUT };

/** How far past the dot the radar ring grows, in points. */
const PING_REACH = 12;

/** The numbers the marks move between. */
interface Marks {
  bar: number[];
  limit: number[];
  cumulative: number[];
}

/** The heading's color for each band. */
const STATUS_TEXT = {
  low: 'text-emerald-600 dark:text-emerald-300',
  high: 'text-amber-600 dark:text-amber-300',
  critical: 'text-red-600 dark:text-red-400',
} as const;

/** Props of `ProgressChart`. */
interface ProgressChartProps {
  chart: ChartData;
  /** Formats an amount in the account currency, e.g. 8400 as "¥8,400". */
  money: (amount: Minor) => string;
  /** True for a past period, whose chart stops at its last day rather than today. */
  ended?: boolean;
}

/**
 * Renders the period's progress chart (BR-CHT-01 to BR-CHT-03, BR-CHT-05):
 * a bar for each day's spending, a solid line for spending so far, a dashed
 * line for the spending limit, and a dot at today, with how far today is
 * under or over the limit above it. The heading, the spending line, the
 * dot, and the bars are green below 90% of today's limit, amber from 90%,
 * and red over it. Bars and the spending line stop at
 * today; later days show only the limit. The series differ in shape, not
 * only color, and a legend names them. On first show the lines draw in and
 * the bars rise; when the numbers change, the marks move to their new
 * heights. While the line draws in, today's dot travels along its tip, as
 * if drawing it. A radar ring pulses around today's dot while the screen is in
 * front, except with Reduce Motion on. It reads as one sentence to screen readers (BR-NFR-07).
 *
 * For the current period, a control switches between the whole period and
 * its last 5 days, each day under its date, with both axes fitted to them
 * (BR-CHT-06); the chart draws in again on the switch, and the choice is
 * remembered on the device.
 */
export function ProgressChart({ chart, money, ended = false }: ProgressChartProps) {
  const { t, i18n } = useTranslation();
  const colors = COLORS[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const reduceMotion = useReduceMotion();
  const focused = useScreenFocused();
  const [width, setWidth] = useState(0);
  const [view, setView] = useChartView();
  // Only the current period has recent days to zoom to, and only past 5 days.
  const zoomable = !ended && chart.today !== null && chart.days.length > RECENT_DAYS;
  const recent = zoomable && view === 'recent';
  const plotted = useMemo(() => (recent ? recentDays(chart) : chart), [chart, recent]);
  const geometry = useMemo(() => chartGeometry(plotted, width, HEIGHT), [plotted, width]);

  const under = chart.today ? chart.today.underLimit.round() : 0;
  const over = under < 0;
  // Colored by spending so far against today's limit: green, amber from 90%, red over it.
  const use = chart.today
    ? limitUse(chart.today.cumulative.toNumber(), chart.today.limit.toNumber())
    : 'low';
  const line = colors.line[use];
  const bar = colors.bar[use];

  // The marks ease from their last heights to the new ones (`progress` 0 → 1),
  // and the whole chart draws in once (`reveal` 0 → 1).
  const from = useSharedValue<Marks>(geometry);
  const to = useSharedValue<Marks>(geometry);
  const progress = useSharedValue(1);
  const reveal = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    const previous = to.get();
    const sameDays = previous.bar.length === geometry.bar.length;
    from.set(sameDays ? previous : geometry);
    to.set({ bar: geometry.bar, limit: geometry.limit, cumulative: geometry.cumulative });
    progress.set(0);
    progress.set(withTiming(1, morph));
    // Another view's days draw in again rather than jump.
    if (!sameDays) {
      reveal.set(0);
      reveal.set(withTiming(1, redraw));
    }
  }, [geometry, from, to, progress, reveal]);
  useEffect(() => {
    if (width > 0) {
      reveal.set(withTiming(1, drawIn));
    }
  }, [width, reveal]);

  const { x, barWidth, shown, baseline } = geometry;
  const bars = useDerivedValue(() => {
    const path = Skia.PathBuilder.Make();
    const a = from.get();
    const b = to.get();
    for (let i = 0; i < shown; i++) {
      const h =
        ((a.bar[i] ?? 0) + ((b.bar[i] ?? 0) - (a.bar[i] ?? 0)) * progress.get()) * reveal.get();
      if (h > 0) {
        const rect = Skia.XYWHRect(x[i] - barWidth / 2, baseline - h, barWidth, h);
        path.addRRect(Skia.RRectXY(rect, barWidth / 2, barWidth / 2));
      }
    }
    return path.detach();
  });
  /**
   * Builds a line through the days up to `count`, `t` of the way from the old
   * heights `a` to the new ones `b`. It reads no shared values itself: a
   * derived value redraws only when a shared value read in its own body
   * changes, so each caller reads `from`, `to`, and `progress` and passes them.
   */
  const linePath = (a: number[], b: number[], t: number, count: number) => {
    'worklet';
    const path = Skia.PathBuilder.Make();
    for (let i = 0; i < count; i++) {
      const value = (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * t;
      if (i === 0) {
        path.moveTo(x[i], baseline - value);
      } else {
        path.lineTo(x[i], baseline - value);
      }
    }
    return path.detach();
  };
  const limit = useDerivedValue(() =>
    linePath(from.get().limit, to.get().limit, progress.get(), x.length),
  );
  const spent = useDerivedValue(() =>
    linePath(from.get().cumulative, to.get().cumulative, progress.get(), shown),
  );
  const markerX = shown > 0 ? x[shown - 1] : 0;
  const markerY = useDerivedValue(() => {
    const a = from.get().cumulative[shown - 1] ?? 0;
    const b = to.get().cumulative[shown - 1] ?? 0;
    return baseline - (a + (b - a) * progress.get());
  });
  // Where the dot is drawn: at the tip of the spending line while it draws in,
  // as if drawing it, then at today. Today's labels and guides fade in as it
  // arrives (`arrived` 0 → 1 over the draw-in's last stretch).
  const dot = useDerivedValue(() => {
    const drawn = reveal.get();
    if (drawn < 1) {
      const contour = Skia.ContourMeasureIter(spent.get(), false, 1).next();
      if (contour) {
        const [position] = contour.getPosTan(contour.length() * drawn);
        return { x: position.x, y: position.y };
      }
    }
    return { x: markerX, y: markerY.get() };
  });
  const dotX = useDerivedValue(() => dot.get().x);
  const dotY = useDerivedValue(() => dot.get().y);
  const arrived = useDerivedValue(() => Math.min(1, Math.max(0, (reveal.get() - 0.85) / 0.15)));
  const guideOpacity = useDerivedValue(() => arrived.get() * 0.35);

  // A radar pulse around today's dot, only for today (not a past period's
  // last day), and only while the screen is in front; none with Reduce Motion.
  const pulsing = !ended && focused && !reduceMotion && shown > 0;
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
  const pulseRadius = useDerivedValue(() => 3.5 + pulse.get() * PING_REACH);
  const pulseOpacity = useDerivedValue(() => (1 - pulse.get()) * 0.6 * arrived.get());

  // Faint guides from today's dot to each axis, where today's values sit.
  const toAmountAxis = useDerivedValue(() => vec(0, markerY.get()));
  const atDot = useDerivedValue(() => vec(markerX, markerY.get()));
  const amountLabel = useAnimatedStyle(() => ({
    opacity: arrived.get(),
    transform: [{ translateY: markerY.get() - 8 }],
  }));
  const guides = useAnimatedStyle(() => ({ opacity: arrived.get() }));
  const todayLeft = Math.min(
    Math.max(markerX - DATE_WIDTH / 2, 0),
    Math.max(0, width - DATE_WIDTH),
  );
  // The period's first and last dates give way to today's where they would meet.
  const showFirst = !chart.today || todayLeft > DATE_WIDTH;
  const showFinal = !chart.today || todayLeft + DATE_WIDTH < width - DATE_WIDTH;

  const status = chart.today
    ? over
      ? t(ended ? 'chart.overEnded' : 'chart.over', { amount: money(-under) })
      : t(ended ? 'chart.underEnded' : 'chart.under', { amount: money(under) })
    : null;
  const label = chart.today
    ? t('chart.label', { spent: money(chart.today.cumulative.round()), status })
    : t('chart.title');
  const first = plotted.days[0]?.date;
  const final = plotted.days.at(-1)?.date;
  const step = plotted.days.length > 0 ? width / plotted.days.length : 0;

  return (
    <View className="gap-3 rounded-3xl bg-gray-100 p-5 dark:bg-gray-900">
      <View accessible accessibilityRole="image" accessibilityLabel={label} className="gap-3">
        {/* The status leaves room for the view switch, which sits over the card's top right. */}
        {status && (
          <Text
            className={`text-base font-semibold ${STATUS_TEXT[use]} ${zoomable ? 'pr-32' : ''}`}
          >
            {status}
          </Text>
        )}
        {!status && zoomable && <View style={{ height: 24 }} />}
        <View className="flex-row" style={{ height: HEIGHT }}>
          <View
            testID="chart-plot"
            className="flex-1"
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          >
            {width > 0 && (
              <Canvas style={{ width, height: HEIGHT }}>
                <Line
                  p1={vec(0.5, 0)}
                  p2={vec(0.5, baseline)}
                  color={colors.axis}
                  strokeWidth={1}
                />
                <Line
                  p1={vec(0, baseline + 0.5)}
                  p2={vec(width, baseline + 0.5)}
                  color={colors.axis}
                  strokeWidth={1}
                />
                {shown > 0 && (
                  <>
                    <Line
                      p1={toAmountAxis}
                      p2={atDot}
                      color={line}
                      strokeWidth={1}
                      opacity={guideOpacity}
                    >
                      <DashPathEffect intervals={[2, 3]} />
                    </Line>
                    <Line
                      p1={atDot}
                      p2={vec(markerX, baseline)}
                      color={line}
                      strokeWidth={1}
                      opacity={0.35}
                    >
                      <DashPathEffect intervals={[2, 3]} />
                    </Line>
                  </>
                )}
                <Path path={bars} color={bar} />
                <Path path={limit} style="stroke" strokeWidth={1.5} color={colors.limit}>
                  <DashPathEffect intervals={[5, 4]} />
                </Path>
                <Path
                  path={spent}
                  style="stroke"
                  strokeWidth={2.5}
                  strokeJoin="round"
                  strokeCap="round"
                  color={line}
                  end={reveal}
                />
                {shown > 0 && (
                  <>
                    {pulsing && (
                      <Circle
                        cx={dotX}
                        cy={dotY}
                        r={pulseRadius}
                        color={line}
                        style="stroke"
                        strokeWidth={2}
                        opacity={pulseOpacity}
                      />
                    )}
                    <Circle cx={dotX} cy={dotY} r={5.5} color={colors.ring} />
                    <Circle cx={dotX} cy={dotY} r={3.5} color={line} />
                  </>
                )}
              </Canvas>
            )}
            {/* Today's amount spent, on the amount axis inside the chart, level
              with the dot, on the card's color so the lines behind it don't show. */}
            {chart.today && shown > 0 && width > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[amountLabel, { left: markerX < AMOUNT_WIDTH + 8 ? markerX + 10 : 4 }]}
                className="absolute top-0 rounded-full bg-gray-100 px-1.5 dark:bg-gray-900"
              >
                <Text style={{ color: line }} className="text-xs font-semibold">
                  {money(chart.today.cumulative.round())}
                </Text>
              </Animated.View>
            )}
          </View>
        </View>
        {/* The date axis: the period's first and last dates, and today's under the dot. */}
        {recent && width > 0 ? (
          // The recent days each under their date, today's in the chart's color.
          <View style={{ height: 16 }}>
            {plotted.days.map((day, index) => (
              <Text
                key={day.date}
                style={[
                  { left: step * index, width: step },
                  index === shown - 1 ? { color: line } : null,
                ]}
                className={`absolute text-center text-xs ${
                  index === shown - 1 ? 'font-semibold' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {formatShortDate(day.date, i18n.language)}
              </Text>
            ))}
          </View>
        ) : (
          first &&
          final && (
            <View style={{ height: 16 }}>
              {showFirst && (
                <Text className="absolute left-0 text-xs text-gray-500 dark:text-gray-400">
                  {formatShortDate(first, i18n.language)}
                </Text>
              )}
              {showFinal && (
                <Text className="absolute right-0 text-xs text-gray-500 dark:text-gray-400">
                  {formatShortDate(final, i18n.language)}
                </Text>
              )}
              {chart.today && shown > 0 && (
                <Animated.Text
                  style={[guides, { left: todayLeft, width: DATE_WIDTH, color: line }]}
                  className="absolute text-center text-xs font-semibold"
                >
                  {formatShortDate(plotted.days[shown - 1].date, i18n.language)}
                </Animated.Text>
              )}
            </View>
          )
        )}
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          <Legend label={t('chart.spentSoFar')}>
            <View style={{ backgroundColor: line }} className="h-0.5 w-4 rounded-full" />
          </Legend>
          <Legend label={t('chart.limit')}>
            <View
              style={{ borderColor: colors.limit }}
              className="h-0 w-4 border-t-2 border-dashed"
            />
          </Legend>
          <Legend label={t('chart.daily')}>
            <View style={{ backgroundColor: bar }} className="h-3 w-1.5 rounded-full" />
          </Legend>
        </View>
      </View>
      {zoomable && (
        <View className="absolute right-5 top-5">
          <ViewSwitch view={recent ? 'recent' : 'period'} onChange={setView} />
        </View>
      )}
    </View>
  );
}

/**
 * Renders the switch between the chart's views (BR-CHT-06): the last 5 days
 * and the whole period, as two buttons, the chosen one raised.
 */
function ViewSwitch({ view, onChange }: { view: ChartView; onChange: (view: ChartView) => void }) {
  const { t } = useTranslation();
  const options: { value: ChartView; label: string; name: string }[] = [
    {
      value: 'recent',
      label: t('chart.recent', { count: RECENT_DAYS }),
      name: t('chart.showRecent', { count: RECENT_DAYS }),
    },
    { value: 'period', label: t('chart.period'), name: t('chart.showPeriod') },
  ];
  return (
    <View className="flex-row rounded-full bg-gray-200 p-0.5 dark:bg-gray-800">
      {options.map((option) => {
        const selected = option.value === view;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.name}
            accessibilityState={{ selected }}
            hitSlop={6}
            onPress={() => onChange(option.value)}
            className={`rounded-full px-2.5 py-1 ${selected ? 'bg-white dark:bg-gray-600' : ''}`}
          >
            <Text
              className={`text-xs font-semibold ${
                selected ? 'text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Renders one entry of the legend: a sample of the mark, and its name. */
function Legend({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {children}
      <Text className="text-xs text-gray-600 dark:text-gray-400">{label}</Text>
    </View>
  );
}
