import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup, syncedRecords } from '../../../helpers/account';
import {
  json,
  mockApi,
  noContent,
  offline,
  requestsSent,
  storedSessionFor,
  syncApi,
  testUser,
} from '../../../helpers/api';
import { hasDatabase } from '../../../helpers/database';
import { routes } from '../../../helpers/routes';

type Routes = Parameters<typeof mockApi>[0];

/**
 * Opens the delete-account screen, signed in with a finished setup, synced
 * unless `synced` is false.
 * @param intro Text of the screen's introduction to wait for.
 */
const openDeleteAccount = async (
  api: Routes,
  { synced = true, intro = /permanently deletes your Lumei account/ } = {},
) => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  if (synced) {
    await syncedRecords();
  }
  const fetch = mockApi({ 'GET /me': json(200, testUser), ...api });
  await renderRouter(routes, { initialUrl: '/settings/delete-account' });
  await screen.findByText(intro);
  return fetch;
};

describe('DeleteAccountScreen (BR-ACC-05)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });

  it('opens from Settings', async () => {
    await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
    await finishedSetup();
    mockApi({ ...syncApi, 'GET /me': json(200, testUser) });
    await renderRouter(routes, { initialUrl: '/settings' });

    await fireEvent.press(await screen.findByLabelText('Delete account'));

    expect(await screen.findByText(/permanently deletes your Lumei account/)).toBeOnTheScreen();
    expect(screen).toHavePathname('/settings/delete-account');
  });

  it('deletes nothing until the confirmation word is typed', async () => {
    const fetch = await openDeleteAccount({ ...syncApi, 'DELETE /me': noContent });

    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELET');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));

    expect(requestsSent(fetch)).not.toContain('DELETE /me');
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  });

  it('deletes the account, signs out, and removes its data from the device', async () => {
    const fetch = await openDeleteAccount({ ...syncApi, 'DELETE /me': noContent });

    // Any case, and spaces around it, still confirm.
    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), ' delete ');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));

    await screen.findByText('Sign in');
    expect(screen).toHavePathname('/sign-in');
    expect(requestsSent(fetch)).toContain('DELETE /me');
    // The server ended every session, so the app doesn't sign out there too.
    expect(requestsSent(fetch)).not.toContain('POST /auth/sign-out');
    await waitFor(() => expect(hasDatabase(testUser.id)).toBe(false));
    expect(await SecureStore.getItemAsync('lumei.session')).toBeNull();
  });

  it('warns that unsynced changes go too, and deletes them', async () => {
    await openDeleteAccount(
      { 'POST /sync/push': offline, 'GET /sync/pull': offline, 'DELETE /me': noContent },
      { synced: false },
    );

    // Setup saved settings, 2 categories, the period, an income, a fixed expense, and the target.
    expect(
      screen.getByText("7 changes on this device haven't synced. They will be deleted too."),
    ).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));

    await screen.findByText('Sign in');
    await waitFor(() => expect(hasDatabase(testUser.id)).toBe(false));
  });

  it.each([
    {
      name: 'Apple or Google can’t revoke now',
      respond: json(503, { code: 'revocation_unavailable', message: '' }),
      expected: /Apple or Google can't confirm right now/,
    },
    { name: 'the API can’t be reached', respond: offline, expected: /Can't reach Lumei/ },
    {
      name: 'the API fails',
      respond: json(500, { code: 'internal_error', message: '' }),
      expected: /Something went wrong, and nothing was deleted/,
    },
  ])('keeps everything and says why when $name', async ({ respond, expected }) => {
    await openDeleteAccount({ ...syncApi, 'DELETE /me': respond });

    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen).toHavePathname('/settings/delete-account');
    expect(useAuth.getState().status).toBe('signedIn');
    expect(hasDatabase(testUser.id)).toBe(true);
  });
});

describe('DeleteAccountScreen in Japanese (BR-ACC-05, BR-NFR-08)', () => {
  beforeAll(() => i18n.changeLanguage('ja'));
  afterAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });

  it('asks for the word in the app’s language', async () => {
    await openDeleteAccount({ ...syncApi, 'DELETE /me': noContent }, { intro: /完全に削除します/ });

    await fireEvent.changeText(screen.getByLabelText('確認のため「削除」と入力してください'), '削除');
    await fireEvent.press(screen.getByRole('button', { name: 'アカウントを削除' }));

    await waitFor(() => expect(hasDatabase(testUser.id)).toBe(false));
  });
});
