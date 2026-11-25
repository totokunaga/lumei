// The sheet a tap on a day of the chart opens (BR-CHT-04).
import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { type ExpenseFixture, finishedSetup, savedExpenses } from '../../helpers/account';
import { json, mockApi, storedSessionFor, syncApi, testUser } from '../../helpers/api';
import { routes } from '../../helpers/routes';

// Only the clock is fake, at noon on Nov 15, 2026: the period is November, with 16 days left.
const NOW = new Date(2026, 10, 15, 12);
const TIMERS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'nextTick',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'performance',
  'hrtime',
] as const;

/**
 * Signs in to the default setup (a budget of ¥150,000 for November's 30
 * days: a limit of ¥5,000 a day) with the expenses, and opens `url`.
 */
const open = async (url: string, expenses: ExpenseFixture[]) => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  await savedExpenses(expenses);
  mockApi({ ...syncApi, 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: url });
};

describe('DayScreen (BR-CHT-04)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });
  afterEach(() => jest.useRealTimers());

  it('opens from a day tapped on the home screen’s chart, in its last 5 days’ view', async () => {
    await open('/', [
      { amount: 3_000, date: '2026-11-14' },
      { amount: 1_200, date: '2026-11-15' },
    ]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Show the last 5 days' }));
    const plot = screen.getByTestId('chart-plot');
    // 300 points for Nov 11 – Nov 15: Nov 14 is the 4th column of 60 points.
    await fireEvent(plot, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 150 } },
    });
    await fireEvent.press(plot, { nativeEvent: { locationX: 200 } });

    expect(await screen.findByText('Yesterday')).toBeOnTheScreen();
    expect(screen).toHavePathname('/day/2026-11-14');
    expect(screen.getByLabelText('Spent this day: ¥3,000')).toBeOnTheScreen();
    expect(screen.getByLabelText('Spent so far: ¥3,000')).toBeOnTheScreen();
    expect(screen.getByLabelText('Limit by this day: ¥70,000')).toBeOnTheScreen();
  });

  it('shows the day’s expenses, which open to edit, and says it carries a share of a big purchase', async () => {
    await open('/day/2026-11-15', [
      { amount: 3_000, date: '2026-11-14' },
      { amount: 1_200, date: '2026-11-15' },
      // Spread over the 16 days left: ¥1,875 a day (BR-CALC-05).
      { amount: 30_000, date: '2026-11-15', isBigPurchase: true },
    ]);

    expect(await screen.findByText('Today')).toBeOnTheScreen();
    expect(screen.getByLabelText('Spent this day: ¥3,075')).toBeOnTheScreen();
    expect(screen.getByLabelText('Spent so far: ¥6,075')).toBeOnTheScreen();
    expect(screen.getByLabelText('Limit by this day: ¥75,000')).toBeOnTheScreen();
    expect(screen.getByText(/includes its share of big purchases/)).toBeOnTheScreen();
    // Only this day's expenses, the big purchase at its full amount.
    expect(screen.getByText('¥30,000')).toBeOnTheScreen();
    expect(screen.getByText('¥1,200')).toBeOnTheScreen();
    expect(screen.queryByText('¥3,000')).toBeNull();

    await fireEvent.press(screen.getAllByRole('button', { name: /Eat Out/ })[0]);
    expect(await screen.findByText('Edit expense')).toBeOnTheScreen();
  });

  it('says a day has no expenses, without a share to explain', async () => {
    await open('/day/2026-11-13', [{ amount: 1_200, date: '2026-11-15' }]);

    expect(await screen.findByText('No expenses on this day.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Spent this day: ¥0')).toBeOnTheScreen();
    expect(screen.queryByText(/includes its share/)).toBeNull();
  });

  it('shows no numbers for a day after today', async () => {
    await open('/day/2026-11-20', []);

    expect(await screen.findByText('No expenses on this day.')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Spent this day/)).toBeNull();
  });

  it('closes back to the home screen', async () => {
    await open('/', [{ amount: 1_200, date: '2026-11-15' }]);
    await fireEvent.press(await screen.findByRole('button', { name: 'Show the last 5 days' }));
    const plot = screen.getByTestId('chart-plot');
    await fireEvent(plot, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 150 } },
    });
    await fireEvent.press(plot, { nativeEvent: { locationX: 270 } });

    await fireEvent.press(await screen.findByRole('button', { name: 'Close' }));
    expect(screen).toHavePathname('/');
  });
});
