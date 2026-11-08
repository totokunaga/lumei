import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from '@/app/(tabs)/index';
import { openUserDatabase } from '@/db/client';
import { ensureCurrentPeriod } from '@/db/records';
import i18n from '@/i18n';

import { finishedSetup, savedExpenses } from '../../helpers/account';
import { testUser } from '../../helpers/api';

// Only the clock is fake, at noon on Nov 15, 2026: the period is November.
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

/** Opens the account's database, as the root layout would, and renders home. */
const renderHome = async () => {
  await openUserDatabase(testUser.id);
  return render(
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
};

/** The expense rows shown, by their screen-reader labels, e.g. "Eat Out, ¥800, …". */
const rows = () =>
  screen
    .queryAllByLabelText(/^(Eat Out|Konbini), ¥/)
    .map((row) => row.props.accessibilityLabel.split(', ').slice(0, 2).join(', '));

/** November's expenses: ¥2,000 and a ¥27,000 big purchase on Eat Out, ¥1,000 on Konbini. */
const november = [
  { amount: 2_000, date: '2026-11-14' },
  { amount: 1_000, date: '2026-11-13', category: 1 },
  { amount: 27_000, date: '2026-11-10', isBigPurchase: true },
];

describe('Spending by category and filters on home (BR-HIS-04, BR-EXP-10)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => jest.useFakeTimers({ now: NOW, doNotFake: [...TIMERS] }));
  afterEach(() => jest.useRealTimers());

  it('shows each category’s spending and share, the largest first, big purchases in full', async () => {
    await finishedSetup();
    await savedExpenses(november);
    await renderHome();

    expect(
      screen.getByRole('header', { name: 'Spending by category: ¥30,000 in total' }),
    ).toBeOnTheScreen();
    const categories = screen.getAllByLabelText(/^(🍔 Eat Out|🏪 Konbini): /);
    expect(categories.map((c) => c.props.accessibilityLabel)).toEqual([
      '🍔 Eat Out: ¥29,000, 97%',
      '🏪 Konbini: ¥1,000, 3%',
    ]);
  });

  it('sits beside the chart, which shows first, and its dot shows it', async () => {
    await finishedSetup();
    await savedExpenses(november);
    await renderHome();
    expect(screen.getByRole('button', { name: 'Show Chart' })).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'Show Spending by category' }));

    expect(screen.getByRole('button', { name: 'Show Spending by category' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Show Chart' })).not.toBeSelected();
  });

  it('hides it, and the dots, while the period has no expenses', async () => {
    await finishedSetup();
    await renderHome();

    expect(screen.queryByText('Spending by category')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Chart' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
  });

  it('filters the list by one or more categories, or to the big purchases, with each day’s total of what shows', async () => {
    await finishedSetup();
    await savedExpenses(november);
    await renderHome();
    expect(rows()).toEqual(['Eat Out, ¥2,000', 'Konbini, ¥1,000', 'Eat Out, ¥27,000']);
    expect(screen.getByRole('button', { name: 'All' })).toBeSelected();
    // Categories by spending, then the big purchases, always last.
    expect(
      within(screen.getByLabelText('Filter expenses'))
        .getAllByRole('button')
        .map((chip) => within(chip).getByText(/./).props.children),
    ).toEqual(['All', '🍔 Eat Out', '🏪 Konbini', 'Big purchases']);

    await fireEvent.press(screen.getByRole('button', { name: '🏪 Konbini' }));

    expect(rows()).toEqual(['Konbini, ¥1,000']);
    expect(screen.getByRole('header', { name: 'November 13: ¥1,000 in total' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '🏪 Konbini' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'All' })).not.toBeSelected();

    // A second category adds its expenses to the first's.
    await fireEvent.press(screen.getByRole('button', { name: '🍔 Eat Out' }));

    expect(rows()).toHaveLength(3);
    expect(screen.getByRole('button', { name: '🍔 Eat Out' })).toBeSelected();
    expect(screen.getByRole('button', { name: '🏪 Konbini' })).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: '🍔 Eat Out' }));

    expect(rows()).toEqual(['Konbini, ¥1,000']);

    await fireEvent.press(screen.getByRole('button', { name: 'Big purchases' }));

    expect(rows()).toEqual(['Eat Out, ¥27,000']);

    await fireEvent.press(screen.getByRole('button', { name: '🍔 Eat Out' }));
    await fireEvent.press(screen.getByRole('button', { name: '🏪 Konbini' }));
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));

    expect(rows()).toHaveLength(3);
    // All clears every chosen category.
    expect(screen.getByRole('button', { name: 'All' })).toBeSelected();
    expect(screen.getByRole('button', { name: '🍔 Eat Out' })).not.toBeSelected();
    expect(screen.getByRole('button', { name: '🏪 Konbini' })).not.toBeSelected();
  });

  it('filters to a category tapped in its spending, from the income list too', async () => {
    await finishedSetup();
    await savedExpenses(november);
    await renderHome();
    await fireEvent.press(screen.getByRole('tab', { name: 'Income' }));

    await fireEvent.press(screen.getByLabelText('🏪 Konbini: ¥1,000, 3%'));

    expect(screen.getByRole('tab', { name: 'Expenses' })).toBeSelected();
    expect(rows()).toEqual(['Konbini, ¥1,000']);
  });

  it('offers big purchases only when the period has one, and shows all again in another period', async () => {
    jest.setSystemTime(new Date(2026, 9, 15, 12));
    await finishedSetup();
    await savedExpenses([{ amount: 800, date: '2026-10-20', category: 1 }]);
    jest.setSystemTime(NOW);
    const db = await openUserDatabase(testUser.id);
    ensureCurrentPeriod(db, '2026-11-15', NOW.getTime());
    await savedExpenses(november);
    await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: '🏪 Konbini' }));

    await fireEvent.press(screen.getByLabelText('Previous period'));

    expect(screen.getByRole('button', { name: 'All' })).toBeSelected();
    expect(screen.queryByRole('button', { name: 'Big purchases' })).toBeNull();
    expect(
      within(screen.getByLabelText('Filter expenses')).queryByRole('button', {
        name: '🍔 Eat Out',
      }),
    ).toBeNull();
    expect(rows()).toEqual(['Konbini, ¥800']);
  });
});
