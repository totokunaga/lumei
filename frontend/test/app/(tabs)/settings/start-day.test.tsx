import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { database } from '@/db/client';
import { readPeriodOn, readSettings } from '@/db/records';
import { periods } from '@/db/schema';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup } from '../../../helpers/account';
import { json, mockApi, storedSessionFor, syncApi, testUser } from '../../../helpers/api';
import { routes } from '../../../helpers/routes';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

// Only the clock is fake, on Nov 10, 2026: with start day 25, the period is Oct 25 – Nov 24.
const NOW = new Date(2026, 10, 10, 12);
const TIMERS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime',
] as const;

/** Opens the start-day screen of an account whose periods start on the 25th. */
const openStartDay = async (prepare: () => void = () => {}) => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup({ periodStartDay: 25 });
  mockApi({ ...syncApi, 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/settings' });
  prepare();
  await fireEvent.press(await screen.findByLabelText('Period start day, Day 25'));
  await screen.findByText('This period');
};

const save = () => screen.getByRole('button', { name: 'Save' });

describe('StartDayScreen (BR-PER-05)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });
  afterEach(() => jest.useRealTimers());

  it('picks the day from this month’s calendar, today marked (BR-PER-01)', async () => {
    await openStartDay();

    // November 2026 starts on a Sunday, so the 1st opens the first week; 31 follows the 30th.
    const days = screen.getAllByRole('radio').map((day) => day.props.accessibilityLabel);
    expect(days.slice(0, 3)).toEqual(['Day 1', 'Day 2', 'Day 3']);
    expect(days.slice(-2)).toEqual(['Day 30', 'Day 31']);
    expect(screen.getByLabelText('Day 10, today')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Day 10')).toBeNull();
    expect(screen.getByLabelText('Day 25')).toBeSelected();
  });

  it('asks where the days before the new start go, with the dates each choice gives', async () => {
    await openStartDay();

    await fireEvent.press(screen.getByLabelText('Day 1'));

    expect(screen.getByText('What should happen to Nov 25 – Nov 30?')).toBeOnTheScreen();
    expect(
      screen.getByText(
        "This period becomes Oct 25 – Nov 30 (37 days). Choose this if this period's money has to last until Dec 1.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        "The next period becomes Nov 25 – Dec 31 (37 days). Choose this if you're paid on Nov 25 for that whole time.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/^The next period is Nov 25 – Nov 30 \(6 days\)\./)).toBeOnTheScreen();
    // Nothing is preselected: the right answer depends on when the user is paid.
    expect(save()).toBeDisabled();
  });

  it.each([
    { choice: 'Add them to this period', current: { start: '2026-10-25', end: '2026-11-30' }, nextPeriodEnd: null },
    { choice: 'Add them to the next period', current: { start: '2026-10-25', end: '2026-11-24' }, nextPeriodEnd: '2026-12-31' },
    { choice: 'Make them a period of their own', current: { start: '2026-10-25', end: '2026-11-24' }, nextPeriodEnd: null },
  ])('saves "$choice" and goes back', async ({ choice, current, nextPeriodEnd }) => {
    await openStartDay();
    await fireEvent.press(screen.getByLabelText('Day 1'));

    await fireEvent.press(screen.getByText(choice));
    await fireEvent.press(save());

    await screen.findByLabelText('Period start day, Day 1');
    expect(screen).toHavePathname('/settings');
    expect(readPeriodOn(database(), '2026-11-10')).toMatchObject(current);
    expect(readSettings(database())).toMatchObject({ periodStartDay: 1, nextPeriodEnd });
  });

  it('asks nothing when the new day starts right after this period', async () => {
    await openStartDay(() => {
      database().update(periods).set({ endDate: '2026-11-30' }).run();
    });

    await fireEvent.press(screen.getByLabelText('Day 1'));

    expect(screen.getByText('Next period: Dec 1 – Dec 31 (31 days)')).toBeOnTheScreen();
    expect(screen.queryByText(/What should happen/)).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('can’t save the day it already has', async () => {
    await openStartDay();

    expect(save()).toBeDisabled();
  });
});
