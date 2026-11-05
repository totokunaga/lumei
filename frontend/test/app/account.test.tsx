import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup } from '../helpers/account';
import { applyPush, json, mockApi, offline, storedSessionFor, syncApi, testUser } from '../helpers/api';
import { routes } from '../helpers/routes';

/** Answers a push by rejecting the period and applying every other row. */
const rejectPeriod = (init: RequestInit | undefined, url: URL) => {
  const { rows } = JSON.parse(String(init?.body)) as { rows: { table: string; id: string }[] };
  if (!rows.some((row) => row.table === 'periods')) {
    return applyPush(init, url);
  }
  return json(200, {
    results: rows.map((row) =>
      row.table === 'periods'
        ? { table: row.table, id: row.id, outcome: 'rejected', code: 'invalid_row' }
        : { table: row.table, id: row.id, outcome: 'applied' },
    ),
  })();
};

describe('AccountScreen (BR-OFF-04)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });

  it.each([
    {
      name: 'that every change synced',
      routes: syncApi,
      expected: ['All changes synced'],
    },
    {
      name: 'how many changes haven’t synced while offline',
      routes: { 'POST /sync/push': offline, 'GET /sync/pull': offline },
      // Setup saved settings, 2 categories, the period, an income, a fixed expense, and the target.
      expected: ['7 changes not synced yet'],
    },
    {
      name: 'how many changes couldn’t sync',
      routes: { ...syncApi, 'POST /sync/push': rejectPeriod },
      expected: ['1 change not synced yet', "1 change couldn't sync."],
    },
  ])('says $name', async ({ routes: sync, expected }) => {
    await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
    await finishedSetup();
    mockApi({ ...sync, 'GET /me': json(200, testUser) });
    await renderRouter(routes, { initialUrl: '/' });

    await fireEvent.press(await screen.findByLabelText('Account'));

    for (const text of expected) {
      expect(await screen.findByText(text)).toBeOnTheScreen();
    }
  });
});
