import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

import { useAuth } from '@/auth/store';
import * as client from '@/db/client';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup } from '../helpers/account';
import { json, mockApi, noContent, offline, storedSessionFor, syncApi, testUser } from '../helpers/api';
import { categorySets } from '../helpers/category-sets';
import { hasDatabase } from '../helpers/database';
import { routes } from '../helpers/routes';

/** Stores a session on the device, as an earlier sign-in would have. */
const storeSession = () =>
  SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));

describe('RootLayout (BR-ACC-03, BR-ACC-06)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      name: 'the sign-in screen without a stored session',
      session: false,
      setup: false,
      expected: { path: '/sign-in', text: 'Sign in' },
    },
    {
      name: 'setup for an account that hasn’t finished it (BR-ACC-06)',
      session: true,
      setup: false,
      expected: { path: '/setup', text: 'Where do you live?' },
    },
    {
      name: 'home for an account that has finished setup',
      session: true,
      setup: true,
      expected: { path: '/', text: 'Remaining today' },
    },
  ])('opens $name', async ({ session, setup, expected }) => {
    if (session) {
      await storeSession();
    }
    if (setup) {
      await finishedSetup();
    }
    mockApi({
      ...syncApi,
      'GET /me': json(200, testUser),
      'GET /category-sets': json(200, { sets: categorySets }),
    });

    await renderRouter(routes, { initialUrl: '/' });

    // Setup opens after the session, the database, the first download, and the
    // regions load, which can take more than findBy's default second under load.
    await screen.findByText(expected.text, {}, { timeout: 4_000 });
    expect(screen).toHavePathname(expected.path);
  });

  it('offers a retry when a new device can’t download the account’s data (BR-ACC-06)', async () => {
    await storeSession();
    mockApi({
      'GET /me': json(200, testUser),
      'GET /sync/pull': [offline, json(200, { rows: [], cursor: 0, has_more: false })],
      'GET /category-sets': json(200, { sets: categorySets }),
    });
    await renderRouter(routes, { initialUrl: '/' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't load your data/);
    await fireEvent.press(screen.getByText('Try again'));

    // The server has no data for the account, so it is new: setup opens.
    await screen.findByText('Japan');
    expect(screen).toHavePathname('/setup');
  });

  it('offers a retry when the account’s data can’t be opened', async () => {
    await storeSession();
    await finishedSetup();
    jest.spyOn(client, 'openUserDatabase').mockRejectedValueOnce(new Error('disk full'));
    mockApi({ ...syncApi, 'GET /me': json(200, testUser) });
    await renderRouter(routes, { initialUrl: '/' });

    await fireEvent.press(await screen.findByText('Try again'));

    await screen.findByLabelText('Add expense');
    expect(screen).toHavePathname('/');
  });

  it.each([
    {
      name: 'at once when every change has synced',
      unsynced: false,
      online: true,
      confirm: false,
    },
    {
      name: 'after syncing the unsynced changes first',
      unsynced: true,
      online: true,
      confirm: false,
    },
    {
      name: 'after confirming that changes that can’t sync will be lost',
      unsynced: true,
      online: false,
      confirm: true,
    },
  ])('signs out and deletes the account’s data $name (BR-ACC-04)', async ({ unsynced, online, confirm }) => {
    await storeSession();
    await finishedSetup();
    if (!unsynced) {
      const db = await client.openUserDatabase(testUser.id);
      const schema = await import('@/db/schema');
      for (const table of schema.syncedTables) {
        db.update(table).set({ pending: false }).run();
      }
    }
    const alert = jest.spyOn(Alert, 'alert');
    mockApi({
      ...(online ? syncApi : { 'POST /sync/push': offline, 'GET /sync/pull': offline }),
      'GET /me': json(200, testUser),
      'POST /auth/sign-out': noContent,
    });
    await renderRouter(routes, { initialUrl: '/settings' });

    await fireEvent.press(await screen.findByText('Sign out'));
    if (confirm) {
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith(
          'Sign out?',
          "7 changes haven't synced yet. They will be lost if you sign out.",
          expect.any(Array),
        ),
      );
      const buttons = alert.mock.calls[0][2] as AlertButton[];
      buttons.find((button) => button.style === 'destructive')?.onPress?.();
    } else {
      expect(alert).not.toHaveBeenCalled();
    }

    await screen.findByText('Sign in');
    expect(screen).toHavePathname('/sign-in');
    await waitFor(() => expect(hasDatabase(testUser.id)).toBe(false));
  });

  it('keeps the account signed in when the user cancels signing out (BR-ACC-04)', async () => {
    await storeSession();
    await finishedSetup();
    const alert = jest.spyOn(Alert, 'alert');
    const fetch = mockApi({ 'GET /me': json(200, testUser), 'POST /sync/push': offline, 'GET /sync/pull': offline });
    await renderRouter(routes, { initialUrl: '/settings' });

    await fireEvent.press(await screen.findByText('Sign out'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    buttons.find((button) => button.style === 'cancel')?.onPress?.();

    expect(screen).toHavePathname('/settings');
    expect(hasDatabase(testUser.id)).toBe(true);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/auth/sign-out'), expect.anything());
  });
});
