import { fireEvent, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { renderRouter } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { useAuth } from '@/auth/store';
import { database } from '@/db/client';
import { expenses } from '@/db/schema';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup, savedExpenses } from '../../helpers/account';
import { json, mockApi, storedSessionFor, testUser } from '../../helpers/api';
import { routes } from '../../helpers/routes';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// Only the clock is fake, at noon on Nov 15, 2026. Setup ran on this day, so
// the first period is November, and the budget is ¥150,000 over 16 days left.
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

/** Opens the app signed in, on the home screen, then the new expense sheet. */
const openSheet = async () => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  mockApi({ 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText('Add expense'));
  await screen.findByText('New expense');
  expect(screen).toHavePathname('/expense/new');
};

/** Reads the saved expenses. */
const saved = () => database().select().from(expenses).all();

describe('NewExpenseScreen (BR-EXP-01, BR-EXP-09)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
    await finishedSetup();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.mocked(Haptics.notificationAsync).mockClear();
  });

  it.each([
    {
      name: 'an expense in three taps, and today’s numbers update (BR-DSH-04)',
      bigPurchase: false,
      amount: '1200',
      earlier: [],
      expected: {
        row: { amount: 1_200, isBigPurchase: false },
        shown: ['Spent today: ¥1,200, Daily allowance: ¥9,375', 'Remaining today: ¥8,175'],
        haptic: 'success',
      },
    },
    {
      name: 'a big purchase, which lowers the allowance rather than today (BR-EXP-05)',
      bigPurchase: true,
      amount: '32000',
      earlier: [],
      expected: {
        row: { amount: 32_000, isBigPurchase: true },
        shown: ['Spent today: ¥0, Daily allowance: ¥7,375', 'Remaining today: ¥7,375'],
        haptic: 'success',
      },
    },
    {
      name: 'an expense that takes today over, with a gentler haptic (BR-DSH-02)',
      bigPurchase: false,
      amount: '10000',
      earlier: [],
      expected: {
        row: { amount: 10_000, isBigPurchase: false },
        shown: ['Remaining today: -¥625'],
        haptic: 'warning',
      },
    },
  ])('records $name', async ({ bigPurchase, amount, expected }) => {
    await openSheet();

    await fireEvent.changeText(screen.getByLabelText('Amount'), amount);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fireEvent.press(screen.getByText('Eat Out'));
    if (bigPurchase) {
      await fireEvent(screen.getByLabelText('Big purchase'), 'valueChange', true);
    }
    await fireEvent.press(screen.getByText('Save'));

    await screen.findByLabelText('Add expense');
    expect(screen).toHavePathname('/');
    for (const label of expected.shown) {
      expect(screen.getByLabelText(label)).toBeOnTheScreen();
    }
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(expected.haptic);
    expect(saved()).toMatchObject([
      {
        ...expected.row,
        date: '2026-11-15',
        spentAt: NOW.getTime(),
        description: null,
        latitude: null,
        pending: true,
      },
    ]);
  });

  it.each([
    { name: 'an earlier date and time', picked: new Date(2026, 10, 10, 9, 30), date: '2026-11-10', spentAt: new Date(2026, 10, 10, 9, 30) },
    { name: 'now instead of a later moment', picked: new Date(2026, 10, 16, 9), date: '2026-11-15', spentAt: NOW },
    { name: 'the first period’s start instead of an earlier day', picked: new Date(2026, 9, 20), date: '2026-11-01', spentAt: new Date(2026, 10, 1) },
  ])('dates the expense $name (BR-EXP-02)', async ({ picked, date, spentAt }) => {
    await openSheet();

    await fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    await fireEvent.press(screen.getByText('Konbini'));
    await fireEvent(screen.getByLabelText('Date and time'), 'dateChange', picked);
    await fireEvent.press(screen.getByText('Save'));

    await screen.findByLabelText('Add expense');
    expect(saved()).toMatchObject([{ date, spentAt: spentAt.getTime() }]);
  });

  it('rejects an amount of 0 (BR-EXP-08)', async () => {
    await openSheet();

    await fireEvent.changeText(screen.getByLabelText('Amount'), '0');
    await fireEvent.press(screen.getByText('Eat Out'));

    expect(screen.getByRole('alert')).toHaveTextContent(/greater than 0/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('closes without saving', async () => {
    await savedExpenses([]);
    await openSheet();

    await fireEvent.changeText(screen.getByLabelText('Amount'), '500');
    await fireEvent.press(screen.getByLabelText('Close'));

    await screen.findByLabelText('Add expense');
    expect(saved()).toEqual([]);
  });
});
