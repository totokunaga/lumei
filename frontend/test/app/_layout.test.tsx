import { fireEvent, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import RootLayout from '@/app/_layout';
import HomeScreen from '@/app/index';
import SignInScreen from '@/app/sign-in';
import { useAuth } from '@/auth/store';
import i18n from '@/i18n';

import { json, mockApi, noContent, storedSessionFor, testUser } from '../helpers/api';

const routes = { _layout: RootLayout, index: HomeScreen, 'sign-in': SignInScreen };
const health = json(200, { status: 'ok' });

describe('RootLayout (BR-ACC-03)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => useAuth.setState({ status: 'restoring', session: null }));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { name: 'the sign-in screen without a stored session', stored: null, expected: '/sign-in' },
    {
      name: 'home with a stored session',
      stored: storedSessionFor(),
      expected: '/',
    },
  ])('opens $name', async ({ stored, expected }) => {
    if (stored) {
      await SecureStore.setItemAsync('lumei.session', JSON.stringify(stored));
    }
    mockApi({ 'GET /me': json(200, testUser), 'GET /health': health });

    await renderRouter(routes, { initialUrl: '/' });

    await screen.findByText(expected === '/' ? 'Sign out' : 'Sign in');
    expect(screen).toHavePathname(expected);
  });

  it('returns to the sign-in screen after signing out (BR-ACC-04)', async () => {
    await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
    mockApi({
      'GET /me': json(200, testUser),
      'GET /health': health,
      'POST /auth/sign-out': noContent,
    });
    await renderRouter(routes, { initialUrl: '/' });

    await fireEvent.press(await screen.findByText('Sign out'));

    await screen.findByText('Sign in');
    expect(screen).toHavePathname('/sign-in');
  });
});
