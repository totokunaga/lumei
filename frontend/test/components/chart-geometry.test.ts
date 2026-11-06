import { chartGeometry } from '@/components/chart-geometry';
import { type PeriodRecords, progressChart } from '@/domain/calculations';

// A USD period of 4 days with a budget of $100.00: Nov 1 – Nov 4, today Nov 2.
const records: PeriodRecords = {
  period: { start: '2026-11-01', end: '2026-11-04' },
  income: [20_000],
  fixedExpenses: [5_000],
  savingTarget: 5_000,
  expenses: [
    { date: '2026-11-01', amount: 1_000, isBigPurchase: false },
    { date: '2026-11-02', amount: 4_000, isBigPurchase: false },
  ],
};

describe('chartGeometry (BR-CHT-01 to BR-CHT-03)', () => {
  const geometry = chartGeometry(progressChart(records, '2026-11-02', 'daysLeft'), 400, 116);

  it('centers each day across the width', () => {
    expect(geometry.x).toEqual([50, 150, 250, 350]);
  });

  it('stops the bars and spending line at today, while the limit runs on', () => {
    expect(geometry.shown).toBe(2);
    expect(geometry.bar.slice(2)).toEqual([0, 0]);
    expect(geometry.limit).toHaveLength(4);
    // After today, the spending line holds its last height.
    expect(geometry.cumulative[3]).toBe(geometry.cumulative[1]);
  });

  it('scales the lines together up to the highest, the limit at the end', () => {
    // $100 by the end, in the 100 points between the 12-point top margin and the baseline.
    expect(geometry.limit).toEqual([25, 50, 75, 100]);
    expect(geometry.cumulative.slice(0, 2)).toEqual([10, 50]);
  });

  it('scales the bars on their own, the busiest day reaching 40% of the height', () => {
    expect(geometry.bar[0]).toBeCloseTo(11.2);
    expect(geometry.bar[1]).toBeCloseTo(44.8);
  });

  it('keeps a few points under the baseline, so a line along it isn’t cut off', () => {
    expect(geometry.baseline).toBe(112);
  });

  it('draws nothing for a width of 0, without failing', () => {
    expect(chartGeometry(progressChart(records, '2026-11-02', 'daysLeft'), 0, 112).x).toEqual([
      0, 0, 0, 0,
    ]);
  });
});
