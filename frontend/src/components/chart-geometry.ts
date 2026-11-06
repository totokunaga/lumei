// Where the progress chart's marks go on screen (BR-CHT-01 to BR-CHT-03):
// pure arithmetic from the chart's data, so it is tested without drawing.
import type { ProgressChart } from '@/domain/calculations';

/** The chart's marks, in points from the canvas's top left. */
export interface ChartGeometry {
  /** Each day's horizontal center, in date order. */
  x: number[];
  /** Each day's bar height; 0 after today (BR-CHT-03). */
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

/** How tall the busiest day's bar is, as a share of the height. */
const BAR_SHARE = 0.4;

/**
 * Works out the chart's marks for a canvas size. The lines share one scale,
 * up to the highest of the limit and spending so far. The bars get their
 * own, the busiest day reaching `BAR_SHARE` of the height, since a day's
 * spending is small next to the period's.
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
  const barMax = Math.max(1, ...bars);
  const lineY = (value: number) => (Math.max(0, value) / lineMax) * (height - TOP - BOTTOM);

  let last = 0;
  return {
    x: days.map((_, index) => step * (index + 0.5)),
    bar: bars.map((value) => (Math.max(0, value) / barMax) * (height - BOTTOM) * BAR_SHARE),
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
