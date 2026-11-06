// The editors of a period's income, fixed expenses, and saving target,
// opened from the home screen's summary (BR-INC-01 to BR-INC-04, BR-TGT-01
// to BR-TGT-03).
import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup } from '../../../helpers/account';
import { json, mockApi, storedSessionFor, syncApi, testUser } from '../../../helpers/api';
import { routes } from '../../../helpers/routes';

// Only the clock is fake, at noon on Nov 15, 2026: the period is November, with 16 days left.
const NOW = new Date(2026, 10, 15, 12);
const TIMERS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime',
] as const;

/**
 * Opens home with the default setup (¥300,000 income, ¥100,000 fixed,
 * ¥50,000 target: ¥9,375 a day) and expands the summary.
 */
const openSummary = async () => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  mockApi({ ...syncApi, 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText('Period details'));
};

const expectAllowance = async (amount: string) =>
  expect(await screen.findByLabelText(new RegExp(`Daily allowance: ${amount}`))).toBeOnTheScreen();

describe('Period budget editors (BR-INC-01, BR-TGT-01)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });
  afterEach(() => jest.useRealTimers());

  it.each([
    {
      name: 'income, and today’s allowance follows',
      row: 'Income: ¥300,000',
      title: 'Income',
      amount: '330000',
      after: 'Income: ¥330,000',
      allowance: '¥11,250',
    },
    {
      name: 'fixed expenses, with 0 allowed (BR-INC-04)',
      row: 'Fixed expenses: ¥100,000',
      title: 'Fixed expenses',
      amount: '0',
      after: 'Fixed expenses: ¥0',
      allowance: '¥15,625',
    },
  ])('edits the period’s $name', async ({ row, title, amount, after, allowance }) => {
    await openSummary();

    await fireEvent.press(screen.getByLabelText(row));
    expect(await screen.findByText(title)).toBeOnTheScreen();
    expect(screen.getByText(/^For Nov 1 – Nov 30\./)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Amount'), amount);
    await fireEvent.press(screen.getByText('Save'));

    expect(await screen.findByLabelText(after)).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    await expectAllowance(allowance);
  });

  it('sets the saving target, and today’s allowance updates at once (BR-TGT-02)', async () => {
    await openSummary();

    await fireEvent.press(screen.getByLabelText('Saving target: ¥50,000'));
    const field = await screen.findByLabelText('Saving target');
    await fireEvent.changeText(field, '');
    // With no target, all ¥200,000 can be spent.
    expect(screen.getByText('You can spend ¥200,000 this period.')).toBeOnTheScreen();
    await fireEvent.changeText(field, '90000');
    await fireEvent.press(screen.getByText('Save'));

    expect(await screen.findByLabelText('Saving target: ¥90,000')).toBeOnTheScreen();
    await expectAllowance('¥6,875');
  });

  it('warns about a target no spending could meet, but saves it (BR-TGT-03)', async () => {
    await openSummary();

    await fireEvent.press(screen.getByLabelText('Saving target: ¥50,000'));
    await fireEvent.changeText(await screen.findByLabelText('Saving target'), '250000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/more than your income minus/);
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByLabelText('Saving target: ¥250,000')).toBeOnTheScreen();
  });

  it('closes without saving', async () => {
    await openSummary();

    await fireEvent.press(screen.getByLabelText('Income: ¥300,000'));
    await fireEvent.changeText(await screen.findByLabelText('Amount'), '1');
    await fireEvent.press(screen.getByLabelText('Close'));

    expect(await screen.findByLabelText('Income: ¥300,000')).toBeOnTheScreen();
  });
});
