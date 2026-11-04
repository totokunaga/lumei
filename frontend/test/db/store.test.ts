import * as client from '@/db/client';
import { useLocalData } from '@/db/store';

import { finishedSetup } from '../helpers/account';

describe('useLocalData.open (BR-ACC-06)', () => {
  beforeEach(() => useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false }));
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

  it('opens the account once, however often it is asked to', async () => {
    const open = jest.spyOn(client, 'openUserDatabase');

    await Promise.all([useLocalData.getState().open('user-1'), useLocalData.getState().open('user-1')]);

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
