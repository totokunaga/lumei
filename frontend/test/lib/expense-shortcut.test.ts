import { renderHook } from '@testing-library/react-native';

import { subscribeToLocalChanges } from '@/db/changes';
import { closeUserDatabase, openUserDatabase } from '@/db/client';
import { useLocalData } from '@/db/store';
import { useExpenseShortcut } from '@/lib/expense-shortcut';

import { ExpenseShortcut } from '../../modules/expense-shortcut';
import { finishedSetup } from '../helpers/account';
import { testUser } from '../helpers/api';

jest.mock('../../modules/expense-shortcut', () => {
  const listeners: (() => void)[] = [];
  return {
    ExpenseShortcut: {
      shareAccount: jest.fn(),
      forgetAccount: jest.fn(),
      addListener: jest.fn((_event: string, listener: () => void) => {
        listeners.push(listener);
        return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
      }),
      /** Plays the shortcut saving an expense, as the native module reports it. */
      emitExpenseAdded: () => [...listeners].forEach((listener) => listener()),
    },
  };
});

const native = ExpenseShortcut as unknown as {
  shareAccount: jest.Mock;
  forgetAccount: jest.Mock;
  addListener: jest.Mock;
  emitExpenseAdded: () => void;
};

/** Saves a finished setup and opens its database, as the root layout has once it is ready. */
const readyAccount = async (currency: 'JPY' | 'EUR' = 'JPY') => {
  await finishedSetup({ currency });
  await openUserDatabase(testUser.id);
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  closeUserDatabase();
});

describe('useExpenseShortcut (BR-EXP-12)', () => {
  it.each([
    {
      name: 'the account’s database, currency, and decimals',
      currency: 'JPY' as const,
      expected: [`lumei-${testUser.id}.db`, 'JPY', 0],
    },
    {
      name: 'two decimals for euros',
      currency: 'EUR' as const,
      expected: [`lumei-${testUser.id}.db`, 'EUR', 2],
    },
  ])('shares $name once setup has finished', async ({ currency, expected }) => {
    await readyAccount(currency);
    await renderHook(() => useExpenseShortcut(testUser.id));
    expect(native.shareAccount).toHaveBeenCalledWith(...expected);
  });

  it('shares nothing without an account ready', async () => {
    await renderHook(() => useExpenseShortcut(null));
    expect(native.shareAccount).not.toHaveBeenCalled();
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it('shows and syncs an expense the shortcut saved, as a change on this device (BR-DSH-04, BR-OFF-03)', async () => {
    await readyAccount();
    const changes = jest.fn();
    const stop = subscribeToLocalChanges(changes);
    const { unmount } = await renderHook(() => useExpenseShortcut(testUser.id));

    native.emitExpenseAdded();
    expect(changes).toHaveBeenCalledTimes(1);

    // Signed out or closed, the app stops listening.
    await unmount();
    native.emitExpenseAdded();
    expect(changes).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops the shortcut when the account’s data is deleted (BR-ACC-04)', async () => {
    await readyAccount();
    useLocalData.getState().forget(testUser.id);
    expect(native.forgetAccount).toHaveBeenCalledTimes(1);
  });
});
