// Where the progress chart's marks go on screen (BR-CHT-01 to BR-CHT-03):
// pure arithmetic from the chart's data, so it is tested without drawing.
import type { ProgressChart } from '@/domain/calculations';

/** The chart's marks, in points from the canvas's top left. */
export interface ChartGeometry {
  /** Each day's horizontal center, in date order. */
  x: number[];
  /**
   * Each day's bar height, on the lines' scale, so a bar never rises above
   * spending so far that day; 0 after today (BR-CHT-03).
   */
  bar: number[];
  /** The width of every bar. */
  barWidth: number;
  /** The spending limit line's height at each day (BR-CALC-06). */
  limit: number[];
  /** The spending-so-far line's height at each day; repeats the last value after today. */
  cumulative: number[];
  /** How many days the bars and spending line reach: up to today (BR-CHT-03). */
  shown: number;
  /** Where heights are measured up from: just above the canvas's bottom edge. */
  baseline: number;
}

/** The space above the highest line, so it isn't cut off. */
const TOP = 12;

/**
 * The space below the baseline, so a line along it keeps its full width:
 * at the canvas's edge, half of its stroke would be cut off.
 */
const BOTTOM = 4;

/** The shortest bar of a day with spending, in points, so it stays visible. */
const MIN_BAR = 2;

/**
 * Works out the chart's marks for a canvas size. The bars and lines share
 * one scale, up to the highest of the limit and spending so far, so a day's
 * bar reads against the lines. A day with spending gets at least
 * `MIN_BAR`, but never more than its spending so far.
 * @returns The marks; see `ChartGeometry`.
 */
export const chartGeometry = (
  chart: ProgressChart,
  width: number,
  height: number,
): ChartGeometry => {
  const days = chart.days;
  const step = days.length > 0 ? width / days.length : width;
  const limits = days.map((day) => day.limit.toNumber());
  const spent = days.map((day) => day.cumulative?.toNumber() ?? null);
  const bars = days.map((day) => day.spending?.toNumber() ?? 0);
  const shown = spent.filter((value) => value !== null).length;

  const lineMax = Math.max(1, ...limits, ...spent.map((value) => value ?? 0));
  const lineY = (value: number) => (Math.max(0, value) / lineMax) * (height - TOP - BOTTOM);

  let last = 0;
  return {
    x: days.map((_, index) => step * (index + 0.5)),
    bar: bars.map((value, index) => {
      const h = lineY(value);
      return value > 0 ? Math.min(Math.max(h, MIN_BAR), lineY(spent[index] ?? value)) : h;
    }),
    barWidth: Math.max(1, Math.min(12, step * 0.6)),
    limit: limits.map(lineY),
    cumulative: spent.map((value) => {
      if (value !== null) {
        last = lineY(value);
      }
      return last;
    }),
    shown,
    baseline: height - BOTTOM,
  };
};

/** How many days the chart's recent view shows (BR-CHT-06). */
export const RECENT_DAYS = 5;

/**
 * Narrows the chart to its recent days (BR-CHT-06): the `days` days ending
 * today, never starting before the period does, so early in a period it
 * shows its first days and the limit after today. Laid out by
 * `chartGeometry`, both axes then fit those days alone.
 * @returns e.g. on day 9 of 30, days 5–9; on day 2, days 1–5. A chart of
 *   `days` days or fewer comes back whole.
 */
export const recentDays = (chart: ProgressChart, days = RECENT_DAYS): ProgressChart => {
  const shown = chart.days.filter((day) => day.cumulative !== null).length;
  const end = Math.min(chart.days.length, Math.max(shown, days));
  const start = Math.max(0, end - days);
  return { ...chart, days: chart.days.slice(start, end) };
};
