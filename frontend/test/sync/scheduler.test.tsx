import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { notifyChange } from '@/db/changes';
import { openUserDatabase } from '@/db/client';
import * as engine from '@/sync/engine';
import { CHANGE_DELAY_MS, INTERVAL_MS, requestSync, useSync, useSyncStatus } from '@/sync/scheduler';

import { testUser } from '../helpers/api';

describe('requestSync (BR-OFF-03)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('runs one cycle at a time, and one more for requests during it', async () => {
    await openUserDatabase(testUser.id);
    let finish: () => void = () => {};
    const syncOnce = jest
      .spyOn(engine, 'syncOnce')
      .mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve('synced'))))
      .mockResolvedValue('synced');

    const first = requestSync();
    const second = requestSync();
    const third = requestSync();
    expect(useSyncStatus.getState().syncing).toBe(true);
    finish();

    expect(await Promise.all([first, second, third])).toEqual(['synced', 'synced', 'synced']);
    expect(syncOnce).toHaveBeenCalledTimes(2);
    expect(useSyncStatus.getState()).toEqual({ syncing: false, last: 'synced' });
  });

  it('fails when no account database is open', async () => {
    const syncOnce = jest.spyOn(engine, 'syncOnce');

    expect(await requestSync()).toBe('failed');
    expect(syncOnce).not.toHaveBeenCalled();
  });
});

describe('useSync (BR-OFF-03)', () => {
  beforeEach(async () => {
    await openUserDatabase(testUser.id);
    // React Native's Jest mock has no app state; the app is in the foreground.
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Lets the cycle a trigger started finish. */
  const settle = () => act(async () => {});

  it.each([
    { name: 'when mounted', trigger: async () => {}, expected: 1 },
    {
      name: 'a few seconds after the user’s changes, once for a burst',
      trigger: async () => {
        await settle();
        notifyChange();
        notifyChange();
        await act(() => jest.advanceTimersByTimeAsync(CHANGE_DELAY_MS));
      },
      expected: 2,
    },
    {
      name: 'not after the sync engine’s own writes',
      trigger: async () => {
        await settle();
        notifyChange('sync');
        await act(() => jest.advanceTimersByTimeAsync(CHANGE_DELAY_MS));
      },
      expected: 1,
    },
    {
      name: 'every minute while open',
      trigger: async () => {
        await settle();
        await act(() => jest.advanceTimersByTimeAsync(INTERVAL_MS));
      },
      expected: 2,
    },
  ])('syncs $name', async ({ trigger, expected }) => {
    const syncOnce = jest.spyOn(engine, 'syncOnce').mockResolvedValue('synced');

    const { unmount } = await renderHook(() => useSync(true));
    await trigger();
    await settle();

    expect(syncOnce).toHaveBeenCalledTimes(expected);
    await unmount();
  });

  it('syncs on returning to the foreground and when the network comes back', async () => {
    const syncOnce = jest.spyOn(engine, 'syncOnce').mockResolvedValue('synced');
    const appState = jest.spyOn(AppState, 'addEventListener');
    const Network = jest.requireMock('expo-network') as {
      addNetworkStateListener: jest.Mock;
    };

    const { unmount } = await renderHook(() => useSync(true));
    await settle();
    const onAppState = appState.mock.calls.filter(([event]) => event === 'change').at(-1)![1] as (
      state: string,
    ) => void;
    const onNetwork = Network.addNetworkStateListener.mock.calls.at(-1)[0] as (state: object) => void;

    await act(async () => onAppState('active'));
    await settle();
    expect(syncOnce).toHaveBeenCalledTimes(2);
    await act(async () => onNetwork({ isConnected: true, isInternetReachable: true }));
    await settle();
    expect(syncOnce).toHaveBeenCalledTimes(3);
    await act(async () => onNetwork({ isConnected: false, isInternetReachable: false }));
    await settle();

    expect(syncOnce).toHaveBeenCalledTimes(3);
    await unmount();
  });

  it('doesn’t sync until enabled', async () => {
    const syncOnce = jest.spyOn(engine, 'syncOnce').mockResolvedValue('synced');

    await renderHook(() => useSync(false));
    await settle();

    expect(syncOnce).not.toHaveBeenCalled();
  });
});
