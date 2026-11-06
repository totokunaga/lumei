import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from '@/app/(tabs)/index';
import { database, openUserDatabase } from '@/db/client';
import { newId } from '@/db/ids';
import { addExpense, ensureCurrentPeriod, readCategories } from '@/db/records';
import i18n from '@/i18n';

import {
  type ExpenseFixture,
  finishedSetup,
  savedExpenses,
  syncedRecords,
} from '../../helpers/account';
import { testUser } from '../../helpers/api';

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

const renderHome = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <GestureHandlerRootView>
        <HomeScreen />
      </GestureHandlerRootView>
    </SafeAreaProvider>,
  );

/**
 * Checks that a number is shown with its label, as a screen reader reads it
 * (BR-NFR-07), e.g. "Budget left: ¥106,000".
 */
const expectShown = (label: string, value: string) => {
  // Spent today and the daily allowance read as one element: "Spent today: ¥0, Daily allowance: ¥9,375".
  const text = `${label}: ${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(screen.getByLabelText(new RegExp(`(^|, )${text}(,|$)`))).toBeOnTheScreen();
};

describe('HomeScreen', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] }));
  afterEach(() => jest.useRealTimers());

  // The default setup: ¥300,000 income, ¥100,000 fixed, ¥50,000 target, so a ¥150,000 budget.
  it.each<{ name: string; expenses: ExpenseFixture[]; expected: Record<string, string> }>([
    {
      name: 'the whole budget spread over the days left before any expense (BR-CALC-03)',
      expenses: [],
      expected: {
        'Remaining today': '¥9,375',
        'Daily allowance': '¥9,375',
        'Spent today': '¥0',
        'Spent so far': '¥0',
        'Budget left': '¥150,000',
        'Days left': '16 days',
      },
    },
    {
      name: 'today’s spending, earlier days, and big purchases (BR-CALC-03, BR-CALC-04, BR-CALC-08)',
      expenses: [
        { amount: 10_000, date: '2026-11-10' },
        { amount: 32_000, date: '2026-11-12', isBigPurchase: true },
        { amount: 2_000, date: '2026-11-15' },
      ],
      expected: {
        'Remaining today': '¥4,750',
        'Daily allowance': '¥6,750',
        'Spent today': '¥2,000',
        'Planned income': '¥300,000',
        'Extra income': '¥0',
        'Fixed expenses': '¥100,000',
        'Saving target': '¥50,000',
        'Big purchases': '¥32,000',
        'Spent so far': '¥44,000',
        'Budget left': '¥106,000',
      },
    },
    {
      name: 'remaining today below 0 as a negative amount (BR-DSH-02)',
      expenses: [{ amount: 10_000, date: '2026-11-15' }],
      expected: { 'Remaining today': '-¥625', 'Spent today': '¥10,000' },
    },
    {
      name: 'the period’s overspend instead of remaining today, and no allowance (BR-DSH-02)',
      expenses: [
        { amount: 140_000, date: '2026-11-10' },
        { amount: 15_000, date: '2026-11-15' },
      ],
      expected: {
        'Over for this period': '-¥5,000',
        'Daily allowance': '¥0',
        'Budget left': '-¥5,000',
      },
    },
  ])('shows $name', async ({ expenses, expected }) => {
    await finishedSetup();
    await savedExpenses(expenses);
    await openUserDatabase(testUser.id);

    await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: 'Period details' }));

    for (const [label, value] of Object.entries(expected)) {
      expectShown(label, value);
    }
    // The period's name is the title (BR-PER-06); with no other period, there are no arrows.
    expect(screen.getByRole('header', { name: 'November 2026' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Previous period')).toBeNull();
    expect(screen.queryByLabelText('Next period')).toBeNull();
  });

  it('shows only today’s numbers and the budget left until the card is expanded', async () => {
    await finishedSetup();
    await openUserDatabase(testUser.id);
    await renderHome();
    const toggle = screen.getByRole('button', { name: 'Period details' });

    expectShown('Remaining today', '¥9,375');
    expectShown('Budget left', '¥150,000');
    expect(screen.queryByText('Planned income')).toBeNull();
    expect(toggle).not.toBeExpanded();

    await fireEvent.press(toggle);
    expectShown('Planned income', '¥300,000');
    expect(toggle).toBeExpanded();

    // Tapping anywhere on the card collapses it too.
    await fireEvent.press(screen.getByText('Spent today / Daily allowance'));
    expect(screen.queryByText('Planned income')).toBeNull();
    expect(toggle).not.toBeExpanded();
  });

  it('updates as soon as an expense is saved (BR-DSH-04, BR-NFR-04)', async () => {
    await finishedSetup();
    const db = await openUserDatabase(testUser.id);
    await renderHome();
    expectShown('Remaining today', '¥9,375');

    const [category] = readCategories(db);
    await act(() =>
      addExpense(
        database(),
        { amount: 1_200, categoryId: category.id, spentAt: NOW.getTime(), isBigPurchase: false },
        newId(),
        NOW.getTime(),
      ),
    );

    expectShown('Remaining today', '¥8,175');
    expectShown('Spent today', '¥1,200');
  });

  it('lists the period’s expenses, newest first (BR-DSH-06)', async () => {
    await finishedSetup();
    await savedExpenses([
      { amount: 32_000, date: '2026-11-12', isBigPurchase: true },
      { amount: 2_000, date: '2026-11-15' },
      { amount: 800, date: '2026-11-14' },
    ]);
    await syncedRecords();
    await openUserDatabase(testUser.id);

    await renderHome();

    // Each is one element to screen readers, read in list order.
    expect(
      screen.getAllByLabelText(/^Eat Out, /).map((row) => row.props.accessibilityLabel),
    ).toEqual([
      'Eat Out, ¥2,000, Today, 12:00 PM',
      'Eat Out, ¥800, Yesterday, 12:00 PM',
      'Eat Out, ¥32,000, Nov 12, 12:00 PM, big purchase',
    ]);
    expect(screen.getByText('Big purchase')).toBeOnTheScreen();
    // Each day has a heading with its total; the rows show only their time (BR-DSH-06).
    expect(screen.getAllByRole('header').map((h) => h.props.accessibilityLabel).filter(Boolean)).toEqual([
      'Today: ¥2,000 in total',
      'Yesterday: ¥800 in total',
      'November 12: ¥32,000 in total',
    ]);
    expect(screen.getAllByText('12:00 PM')).toHaveLength(3);
  });

  it('totals every expense of a day under its heading', async () => {
    await finishedSetup();
    await savedExpenses([
      { amount: 500, date: '2026-11-15' },
      { amount: 1_500, date: '2026-11-15' },
      { amount: 700, date: '2026-11-13' },
    ]);
    await openUserDatabase(testUser.id);

    await renderHome();

    expect(screen.getByLabelText('Today: ¥2,000 in total')).toBeOnTheScreen();
    expect(screen.getByLabelText('November 13: ¥700 in total')).toBeOnTheScreen();
  });

  it('shows a new expense as soon as it is saved (BR-DSH-04)', async () => {
    await finishedSetup();
    await savedExpenses([{ amount: 800, date: '2026-11-14' }]);
    const db = await openUserDatabase(testUser.id);
    await renderHome();

    const [, konbini] = readCategories(db);
    await act(() =>
      addExpense(
        database(),
        { amount: 450, categoryId: konbini.id, spentAt: NOW.getTime(), isBigPurchase: false },
        newId(),
        NOW.getTime(),
      ),
    );

    // FlashList lays rows out by position, not by tree order, so the order is checked above.
    expect(
      await screen.findByLabelText('Konbini, ¥450, Today, 12:00 PM, Not synced yet'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Eat Out, ¥800, Yesterday, 12:00 PM, Not synced yet'),
    ).toBeOnTheScreen();
  });

  it('marks the expenses that haven’t synced, and the ones that couldn’t (BR-OFF-04)', async () => {
    await finishedSetup();
    const [failed] = await savedExpenses([
      { amount: 700, date: '2026-11-13' },
      { amount: 800, date: '2026-11-14' },
    ]);
    await syncedRecords({ failedId: failed });
    await savedExpenses([{ amount: 2_000, date: '2026-11-15' }]);
    await openUserDatabase(testUser.id);

    await renderHome();

    expect(
      screen.getAllByLabelText(/^Eat Out, /).map((row) => row.props.accessibilityLabel),
    ).toEqual([
      'Eat Out, ¥2,000, Today, 12:00 PM, Not synced yet',
      'Eat Out, ¥800, Yesterday, 12:00 PM',
      "Eat Out, ¥700, Nov 13, 12:00 PM, Couldn't sync",
    ]);
  });

  it.each([
    {
      name: 'met its target',
      october: 120_000,
      saved: '¥80,000',
      verdict: 'Met the saving target of ¥50,000',
    },
    {
      name: 'missed its target',
      october: 180_000,
      saved: '¥20,000',
      verdict: '¥30,000 short of the saving target of ¥50,000',
    },
  ])('steps back to a past period that $name, and forward again (BR-HIS-01, BR-HIS-02)', async ({ october, saved, verdict }) => {
    // Set up in October, with one expense then; it's now November.
    jest.setSystemTime(new Date(2026, 9, 15, 12));
    await finishedSetup();
    await savedExpenses([{ amount: october, date: '2026-10-20' }]);
    jest.setSystemTime(NOW);
    const db = await openUserDatabase(testUser.id);
    ensureCurrentPeriod(db, '2026-11-15', NOW.getTime());
    await renderHome();
    expect(screen.queryByLabelText('Next period')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Previous period'));

    expect(screen.getByRole('header', { name: 'October 2026' })).toBeOnTheScreen();
    // ¥300,000 income − ¥100,000 fixed − the October expense.
    expect(screen.getByLabelText(`Saved: ${saved}, ${verdict}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(new RegExp(`^Eat Out, ¥${(october).toLocaleString('en')}, Oct 20`))).toBeOnTheScreen();
    // Expenses are added to today, so a past period doesn't offer it; there's no earlier period.
    expect(screen.queryByLabelText('Add expense')).toBeNull();
    expect(screen.queryByLabelText('Previous period')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Next period'));

    expect(screen.getByRole('header', { name: 'November 2026' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Add expense')).toBeOnTheScreen();
    expectShown('Remaining today', '¥9,375');
  });

  it('opens a past period’s editors from its result (BR-HIS-03)', async () => {
    jest.setSystemTime(new Date(2026, 9, 15, 12));
    await finishedSetup();
    jest.setSystemTime(NOW);
    const db = await openUserDatabase(testUser.id);
    ensureCurrentPeriod(db, '2026-11-15', NOW.getTime());
    await renderHome();

    await fireEvent.press(screen.getByLabelText('Previous period'));

    expect(screen.getByRole('button', { name: 'Planned income: ¥300,000' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Saving target: ¥50,000' })).toBeOnTheScreen();
  });

  it('says so when the period has no expenses yet', async () => {
    await finishedSetup();
    await openUserDatabase(testUser.id);

    await renderHome();

    expect(screen.getByText('No expenses yet this period.')).toBeOnTheScreen();
  });

  it('says so when no period covers today', async () => {
    await openUserDatabase(testUser.id);

    await renderHome();

    expect(screen.getByText('No period covers today yet.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Add expense')).toBeNull();
  });
});
