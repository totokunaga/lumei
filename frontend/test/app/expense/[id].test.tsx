import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { useAuth } from '@/auth/store';
import { database } from '@/db/client';
import { expenses } from '@/db/schema';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup, savedExpenses } from '../../helpers/account';
import { json, mockApi, storedSessionFor, syncApi, testUser } from '../../helpers/api';
import { routes } from '../../helpers/routes';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

// Only the clock is fake, at noon on Nov 15, 2026: the period is November.
const NOW = new Date(2026, 10, 15, 12);
const TIMERS = [
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'nextTick', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'performance', 'hrtime',
] as const;

/** The expense the tests edit: ¥800 for Eat Out, yesterday at noon. */
const ROW = 'Eat Out, ¥800, Yesterday, 12:00 PM, Not synced yet';

/** Opens home with one expense, then that expense's sheet. */
const openExpense = async () => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  const [id] = await savedExpenses([{ amount: 800, date: '2026-11-14' }]);
  // Offline, so nothing syncs while the test runs and the rows stay "not synced".
  mockApi({ 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText(ROW));
  await screen.findByText('Edit expense');
  expect(screen).toHavePathname(`/expense/${id}`);
  return id;
};

describe('EditExpenseScreen (BR-EXP-06)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });
  afterEach(() => jest.useRealTimers());

  it('opens with the expense’s values, and saves every change (BR-EXP-03, BR-EXP-05)', async () => {
    const id = await openExpense();
    expect(screen.getByLabelText('Amount')).toHaveDisplayValue('800');
    expect(screen.getByRole('radio', { name: /Eat Out/ })).toBeSelected();

    await fireEvent.changeText(screen.getByLabelText('Amount'), '950');
    await fireEvent.press(screen.getByText('Konbini'));
    await fireEvent.changeText(screen.getByLabelText('Description (optional)'), '  Snacks ');
    await fireEvent(screen.getByLabelText('Big purchase'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByLabelText('Konbini, ¥950, Yesterday, 12:00 PM, big purchase, Not synced yet'),
    ).toBeOnTheScreen();
    expect(database().select().from(expenses).get()).toMatchObject({
      id,
      amount: 950,
      description: 'Snacks',
      isBigPurchase: true,
      date: '2026-11-14',
    });
  });

  it('deletes the expense, and offers to undo it', async () => {
    await openExpense();

    await fireEvent.press(screen.getByText('Delete expense'));

    expect(await screen.findByText('Expense deleted')).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(screen.queryByLabelText(ROW)).toBeNull();
    expect(screen.getByText('No expenses yet this period.')).toBeOnTheScreen();
    expect(Haptics.impactAsync).toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByLabelText(ROW)).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Expense deleted')).toBeNull());
  });
});

/** Opens home with one expense, without opening it. */
const openHome = async () => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  const [id] = await savedExpenses([{ amount: 800, date: '2026-11-14' }]);
  mockApi({ 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/' });
  await screen.findByLabelText(ROW);
  // The row's width, which a full swipe must pass half of.
  await fireEvent(screen.getByTestId(`swipe-row-${id}`), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 342, height: 64 } },
  });
  return id;
};

/** Swipes the expense's row left by `distance` points and lets go. */
const swipe = async (id: string, distance: number) => {
  const pan = createGestureController(`swipe-${id}`);
  await act(() => {
    pan.begin();
    pan.activate();
    pan.update({ translationX: -distance });
    pan.end({ translationX: -distance, velocityX: 0 });
  });
};

describe('Swiping an expense on home (BR-EXP-06)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] });
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
    jest.mocked(Haptics.selectionAsync).mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('deletes it when swiped past half the row, with a haptic there, and offers to undo', async () => {
    const id = await openHome();

    await swipe(id, 240);

    expect(await screen.findByText('Expense deleted')).toBeOnTheScreen();
    expect(screen.queryByLabelText(ROW)).toBeNull();
    expect(Haptics.selectionAsync).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByLabelText(ROW)).toBeOnTheScreen();
  });

  it('reveals the delete button on a short swipe, which deletes it', async () => {
    const id = await openHome();

    await swipe(id, 90);
    expect(screen.queryByText('Expense deleted')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete expense' }));

    expect(await screen.findByText('Expense deleted')).toBeOnTheScreen();
    expect(screen.queryByLabelText(ROW)).toBeNull();
  });

  it('closes an open row on a tap, rather than opening it', async () => {
    const id = await openHome();
    await swipe(id, 90);

    await fireEvent.press(screen.getByLabelText(ROW));

    expect(screen).toHavePathname('/');
    await fireEvent.press(screen.getByLabelText(ROW));
    expect(await screen.findByText('Edit expense')).toBeOnTheScreen();
  });

  it('keeps it when the swipe is too short', async () => {
    const id = await openHome();

    await swipe(id, 20);
    await fireEvent.press(screen.getByLabelText(ROW));

    expect(await screen.findByText('Edit expense')).toBeOnTheScreen();
  });

  it('deletes it with the screen reader’s delete action', async () => {
    await openHome();

    await fireEvent(screen.getByLabelText(ROW), 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });

    expect(await screen.findByText('Expense deleted')).toBeOnTheScreen();
  });
});
