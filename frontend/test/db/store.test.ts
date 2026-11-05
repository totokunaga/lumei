import * as client from '@/db/client';
import { readPeriodRecords } from '@/db/records';
import { useLocalData } from '@/db/store';

import { finishedSetup } from '../helpers/account';
import { json, mockApi, offline, syncApi } from '../helpers/api';

/** The settings another device saved at setup. */
const settingsRow = {
  table: 'settings',
  id: 'user-1',
  updated_at: 1_000,
  deleted_at: null,
  region: 'jp',
  currency: 'JPY',
  period_start_day: 1,
  big_purchase_spread: 'daysLeft',
  setup_completed_at: 1_000,
};

describe('useLocalData.open (BR-ACC-06)', () => {
  beforeEach(() => {
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
    // An account with no data on the server, unless a case says otherwise.
    mockApi(syncApi);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      name: 'ready without setup for a new account',
      setup: async () => {},
      expected: { status: 'ready', userId: 'user-1', setupCompleted: false },
    },
    {
      name: 'ready with setup for an account that finished it',
      setup: () => finishedSetup({}, 'user-1'),
      expected: { status: 'ready', userId: 'user-1', setupCompleted: true },
    },
    {
      name: 'ready with setup on a new device for an account set up on another one',
      setup: async () => {
        mockApi({
          ...syncApi,
          'GET /sync/pull': json(200, { rows: [settingsRow], cursor: 1, has_more: false }),
        });
      },
      expected: { status: 'ready', userId: 'user-1', setupCompleted: true },
    },
    {
      name: 'unreachable on a new device that can’t download the account’s data',
      setup: async () => {
        mockApi({ 'GET /sync/pull': offline });
      },
      expected: { status: 'unreachable', userId: 'user-1', setupCompleted: false },
    },
    {
      name: 'unreachable on a new device when the API answers with an error',
      setup: async () => {
        mockApi({ 'GET /sync/pull': json(500, { code: 'internal_error', message: '' }) });
      },
      expected: { status: 'unreachable', userId: 'user-1', setupCompleted: false },
    },
    {
      name: 'ready offline for an account set up on this device',
      setup: async () => {
        await finishedSetup({}, 'user-1');
        mockApi({});
      },
      expected: { status: 'ready', userId: 'user-1', setupCompleted: true },
    },
    {
      name: 'failed when the database can’t be opened',
      setup: async () => {
        jest.spyOn(client, 'openUserDatabase').mockRejectedValueOnce(new Error('disk full'));
      },
      expected: { status: 'failed', userId: 'user-1', setupCompleted: false },
    },
  ])('is $name', async ({ setup, expected }) => {
    await setup();

    await useLocalData.getState().open('user-1');

    expect(useLocalData.getState()).toMatchObject(expected);
  });

  it('creates the periods that started while the app was closed (BR-PER-03)', async () => {
    // Set up in October; opened again in December. Only the clock is faked.
    jest.useFakeTimers({
      now: new Date(2026, 9, 15, 12),
      doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'],
    });
    await finishedSetup({}, 'user-1');
    jest.setSystemTime(new Date(2026, 11, 3, 9));

    await useLocalData.getState().open('user-1');
    jest.useRealTimers();

    expect(readPeriodRecords(client.database(), '2026-12-03')).toMatchObject({
      period: { start: '2026-12-01', end: '2026-12-31' },
      income: [300_000],
    });
  });

  it('downloads the account’s data again when retried after being unreachable', async () => {
    mockApi({
      'GET /sync/pull': [offline, json(200, { rows: [settingsRow], cursor: 1, has_more: false })],
    });
    await useLocalData.getState().open('user-1');
    expect(useLocalData.getState().status).toBe('unreachable');

    await useLocalData.getState().open('user-1');

    expect(useLocalData.getState()).toMatchObject({ status: 'ready', setupCompleted: true });
  });

  it('opens the account once, however often it is asked to', async () => {
    const open = jest.spyOn(client, 'openUserDatabase');

    await Promise.all([
      useLocalData.getState().open('user-1'),
      useLocalData.getState().open('user-1'),
    ]);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'opens', outcome: 'resolve' },
    { name: 'fails', outcome: 'reject' },
  ])('ignores an account that $name after another one was opened', async ({ outcome }) => {
    let settle: () => void = () => {};
    jest.spyOn(client, 'openUserDatabase').mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settle = () =>
            outcome === 'resolve' ? resolve({} as client.Database) : reject(new Error('gone'));
        }),
    );

    const first = useLocalData.getState().open('user-1');
    await useLocalData.getState().open('user-2');
    settle();
    await first;

    expect(useLocalData.getState()).toMatchObject({ status: 'ready', userId: 'user-2' });
  });
});
