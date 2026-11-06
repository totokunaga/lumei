// Extra income on the home screen and its sheets (BR-INC-06, BR-DSH-06).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { database, openUserDatabase } from '@/db/client';
import { newId } from '@/db/ids';
import { addExtraIncome } from '@/db/records';
import { extraIncomes } from '@/db/schema';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup } from '../../helpers/account';
import { json, mockApi, storedSessionFor, testUser } from '../../helpers/api';
import { routes } from '../../helpers/routes';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

// Only the clock is fake, at noon on Nov 15, 2026: November, with 16 days left.
const NOW = new Date(2026, 10, 15, 12);
const TIMERS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime',
] as const;

/** Opens home, offline so nothing syncs, after `prepare` adds records. */
const openHome = async (prepare: () => void = () => {}) => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  await openUserDatabase(testUser.id);
  prepare();
  mockApi({ 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/' });
  await screen.findByLabelText('Add expense');
};

/** Records extra income on Nov 14 at noon. */
const receivedYesterday = (amount: number, description: string | null) =>
  addExtraIncome(
    database(),
    { amount, receivedAt: new Date(2026, 10, 14, 12).getTime(), description },
    newId(),
    NOW.getTime(),
  );

const allowance = (amount: string) =>
  screen.findByLabelText(new RegExp(`Daily allowance: ${amount}`));

describe('Extra income (BR-INC-06)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });
  afterEach(() => jest.useRealTimers());

  it('lists the planned income, then extra income by day, when Income is chosen (BR-DSH-06)', async () => {
    await openHome(() => receivedYesterday(3_000, 'Aki paid back dinner'));
    expect(screen.queryByText('Planned')).toBeNull();

    await fireEvent.press(screen.getByText('Income'));

    expect(screen.getByLabelText('Planned: ¥300,000 in total')).toBeOnTheScreen();
    expect(screen.getByLabelText('Salary, ¥300,000')).toBeOnTheScreen();
    expect(screen.getByLabelText('Yesterday: +¥3,000 in total')).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Aki paid back dinner, +¥3,000, Yesterday, 12:00 PM, Not synced yet'),
    ).toBeOnTheScreen();
    // The add button now adds income.
    expect(screen.getByLabelText('Add income')).toBeOnTheScreen();
  });

  it('records extra income, which raises today’s allowance at once (BR-CALC-02)', async () => {
    await openHome();
    await allowance('¥9,375');
    await fireEvent.press(screen.getByText('Income'));
    expect(screen.getByText('No extra income this period.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Add income'));
    await screen.findByText('New income');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '3000');
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), 'Bonus');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText(/^Bonus, \+¥3,000, Today, 12:00 PM/)).toBeOnTheScreen();
    expect(database().select().from(extraIncomes).all()).toMatchObject([
      { amount: 3_000, description: 'Bonus', date: '2026-11-15' },
    ]);
    // (¥150,000 + ¥3,000) / 16 days left.
    await allowance('¥9,562');
    await expectExtra('¥3,000');
  });

  it('edits extra income, and names it "Extra income" without a description', async () => {
    await openHome(() => receivedYesterday(3_000, 'Dinner'));
    await fireEvent.press(screen.getByText('Income'));

    await fireEvent.press(screen.getByLabelText(/^Dinner, \+¥3,000/));
    await screen.findByText('Edit income');
    expect(screen.getByLabelText('Amount')).toHaveDisplayValue('3,000');
    await fireEvent.changeText(screen.getByLabelText('Amount'), '4500');
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText(/^Extra income, \+¥4,500, Yesterday/)).toBeOnTheScreen();
  });

  it('deletes extra income from its sheet, and offers to undo it', async () => {
    await openHome(() => receivedYesterday(3_000, 'Dinner'));
    await fireEvent.press(screen.getByText('Income'));

    await fireEvent.press(screen.getByLabelText(/^Dinner, \+¥3,000/));
    await fireEvent.press(await screen.findByText('Delete income'));

    expect(await screen.findByText('Income deleted')).toBeOnTheScreen();
    expect(screen.getByText('No extra income this period.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByLabelText(/^Dinner, \+¥3,000/)).toBeOnTheScreen();
  });

  it('opens the planned income editor from the planned card', async () => {
    await openHome();
    await fireEvent.press(screen.getByText('Income'));

    await fireEvent.press(screen.getByLabelText('Salary, ¥300,000'));

    expect(await screen.findByText(/^For Nov 1 – Nov 30\./)).toBeOnTheScreen();
    await waitFor(() => expect(screen).toHavePathname(expect.stringMatching(/\/income$/)));
  });
});

/** Checks the summary's extra income row, after expanding the card. */
const expectExtra = async (amount: string) => {
  await fireEvent.press(screen.getByLabelText('Period details'));
  expect(screen.getByLabelText(`Extra income: ${amount}`)).toBeOnTheScreen();
};
