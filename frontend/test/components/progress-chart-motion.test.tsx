// The chart's marks move together when the numbers change: the spending line
// with the bars and today's dot, not after them. Skia's stand-in records what
// each path holds, so the test can follow the marks frame by frame.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ProgressChart } from '@/components/progress-chart';
import { type PeriodRecords, progressChart } from '@/domain/calculations';
import { formatMoney } from '@/domain/money';

jest.mock('@shopify/react-native-skia', () => {
  const stand = jest.requireActual('../helpers/skia');
  const { View } = jest.requireActual('react-native');
  /** Records each point's height and each bar's height. */
  const makeBuilder = () => {
    const heights: number[] = [];
    const bars: number[] = [];
    const builder = {
      moveTo: (_x: number, y: number) => (heights.push(y), builder),
      lineTo: (_x: number, y: number) => (heights.push(y), builder),
      addRRect: (rrect: { rect: { height: number } }) => (bars.push(rrect.rect.height), builder),
      addCircle: () => builder,
      detach: () => ({ heights: [...heights], bars: [...bars] }),
    };
    return builder;
  };
  return {
    ...stand,
    Skia: { ...stand.Skia, PathBuilder: { Make: makeBuilder } },
    Path: (props: object) => <View testID="skia-path" {...props} />,
  };
});

// A yen period of 10 days; on Nov 3, today's spending goes from ¥1,000 to ¥20,000.
const records = (today: number): PeriodRecords => ({
  period: { start: '2026-11-01', end: '2026-11-10' },
  income: [200_000],
  fixedExpenses: [50_000],
  savingTarget: 50_000,
  expenses: [
    { date: '2026-11-02', amount: 5_000, isBigPurchase: false },
    { date: '2026-11-03', amount: today, isBigPurchase: false },
  ],
});
const money = (amount: number) => formatMoney(amount, 'JPY', 'en');
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

/** Reads the spending line's end and today's dot, in points from the top. */
const marks = () => {
  const [, , spent] = screen.getAllByTestId('skia-path');
  const lineEnd = (spent.props.path.value as { heights: number[] }).heights.at(-1)!;
  const dot = screen
    .getAllByTestId('skia-circle')
    .find((circle) => circle.props.r === 3.5 && typeof circle.props.cy === 'object')!;
  return { lineEnd, dot: dot.props.cy.value as number };
};

describe('ProgressChart’s marks when the numbers change', () => {
  it('moves the spending line with today’s dot, every frame', async () => {
    const { rerender } = await render(
      <ProgressChart chart={progressChart(records(1_000), '2026-11-03', 'daysLeft')} money={money} />,
    );
    await fireEvent(screen.getByTestId('chart-plot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 150 } },
    });
    // Let the first draw-in finish.
    await wait(2_000);
    const before = marks();

    await rerender(
      <ProgressChart chart={progressChart(records(20_000), '2026-11-03', 'daysLeft')} money={money} />,
    );
    await wait(150);
    const midway = marks();
    await wait(450);
    const after = marks();

    // Midway, the line has moved as far as the dot, partway to its new height.
    expect(midway.lineEnd).toBeCloseTo(midway.dot, 0);
    expect(midway.lineEnd).toBeLessThan(before.lineEnd);
    expect(midway.lineEnd).toBeGreaterThan(after.lineEnd);
    expect(after.lineEnd).toBeCloseTo(after.dot, 0);
  });
});
