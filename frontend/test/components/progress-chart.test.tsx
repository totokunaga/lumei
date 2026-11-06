import { fireEvent, render, screen } from '@testing-library/react-native';

import * as motion from '@/components/motion';
import { ProgressChart } from '@/components/progress-chart';
import { type PeriodRecords, progressChart } from '@/domain/calculations';
import { formatMoney } from '@/domain/money';
import i18n from '@/i18n';

// A yen period of 10 days with a budget of ¥100,000: the limit is ¥10,000 a day.
const records = (spent: number): PeriodRecords => ({
  period: { start: '2026-11-01', end: '2026-11-10' },
  income: [200_000],
  fixedExpenses: [50_000],
  savingTarget: 50_000,
  expenses: [{ date: '2026-11-03', amount: spent, isBigPurchase: false }],
});

const money = (amount: number) => formatMoney(amount, 'JPY', 'en');

describe('ProgressChart (BR-CHT-01 to BR-CHT-05)', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it.each([
    {
      name: 'under the limit, in green',
      spent: 21_600,
      status: "¥8,400 under today's spending limit",
      label: "Spent ¥21,600 so far. ¥8,400 under today's spending limit.",
    },
    {
      name: 'over the limit',
      spent: 33_000,
      status: "¥3,000 over today's spending limit",
      label: "Spent ¥33,000 so far. ¥3,000 over today's spending limit.",
    },
  ])('says how far today is from the limit: $name (BR-CHT-02)', async ({ spent, status, label }) => {
    await render(<ProgressChart chart={progressChart(records(spent), '2026-11-03', 'daysLeft')} money={money} />);

    expect(screen.getByText(status)).toBeOnTheScreen();
    // One sentence for screen readers (BR-NFR-07).
    expect(screen.getByLabelText(label)).toBeOnTheScreen();
  });

  /** Renders the chart on a day, laid out 300 points wide. */
  const renderOn = async (today: string, spent = 1_000) => {
    await render(<ProgressChart chart={progressChart(records(spent), today, 'daysLeft')} money={money} />);
    await fireEvent(screen.getByTestId('chart-plot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 150 } },
    });
  };

  it('says the same for a past period, as of its end', async () => {
    await render(
      <ProgressChart chart={progressChart(records(88_000), '2026-11-10', 'daysLeft')} money={money} ended />,
    );

    expect(screen.getByText("¥12,000 under the period's spending limit")).toBeOnTheScreen();
  });

  it('names the series in a legend (BR-CHT-05)', async () => {
    await renderOn('2026-11-05');

    for (const text of ['Spent so far', 'Limit', 'Daily spending']) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
  });

  it.each([
    { name: 'between the first and last days, which show too', today: '2026-11-05', dates: ['Nov 1', 'Nov 5', 'Nov 10'] },
    { name: 'instead of the first day, next to it', today: '2026-11-01', dates: ['Nov 1', 'Nov 10'] },
    { name: 'instead of the last day, next to it', today: '2026-11-10', dates: ['Nov 1', 'Nov 10'] },
  ])('puts today’s date on the date axis $name', async ({ today, dates }) => {
    await renderOn(today);

    for (const date of dates) {
      expect(screen.getAllByText(date)).toHaveLength(1);
    }
  });

  it('puts the amount spent so far on the amount axis', async () => {
    await renderOn('2026-11-05', 21_600);

    expect(screen.getByText('¥21,600')).toBeOnTheScreen();
  });
});

describe('ProgressChart’s radar pulse around today', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  afterEach(() => jest.restoreAllMocks());

  /** Counts the rings drawn as outlines: the pulse is the only one. */
  const rings = () =>
    screen.queryAllByTestId('skia-circle').filter((circle) => circle.props.style === 'stroke');

  it.each([
    { name: 'pulses on today’s dot', ended: false, reduceMotion: false, expected: 1 },
    { name: 'is still on a past period’s last day', ended: true, reduceMotion: false, expected: 0 },
    { name: 'is still with Reduce Motion on', ended: false, reduceMotion: true, expected: 0 },
  ])('$name', async ({ ended, reduceMotion, expected }) => {
    jest.spyOn(motion, 'useReduceMotion').mockReturnValue(reduceMotion);
    await render(
      <ProgressChart
        chart={progressChart(records(1_000), '2026-11-05', 'daysLeft')}
        money={money}
        ended={ended}
      />,
    );
    await fireEvent(screen.getByTestId('chart-plot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 150 } },
    });

    expect(rings()).toHaveLength(expected);
  });
});
