import { fireEvent, screen } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { renderRouter } from 'expo-router/testing-library';

import RootLayout from '@/app/_layout';
import HomeScreen from '@/app/index';
import SignInScreen from '@/app/sign-in';
import * as providers from '@/auth/providers';
import { useAuth } from '@/auth/store';
import i18n from '@/i18n';

import { json, mockApi, offline, requestBody, signedIn } from '../helpers/api';

// Apple's button is native; the stand-in is a plain button with its label.
jest.mock('expo-apple-authentication', () => require('../helpers/apple-authentication'));

const routes = { _layout: RootLayout, index: HomeScreen, 'sign-in': SignInScreen };
const health = json(200, { status: 'ok' });

/** Opens the app signed out, on the sign-in screen. */
const openSignIn = async () => {
  await renderRouter(routes, { initialUrl: '/sign-in' });
  await screen.findByText('Sign in');
};

describe('SignInScreen (BR-ACC-01)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      name: 'Apple',
      button: 'Sign in with Apple',
      setup: () =>
        jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
          identityToken: 'apple-id-token',
        } as AppleAuthentication.AppleAuthenticationCredential),
      expected: { provider: 'apple', id_token: 'apple-id-token' },
    },
    {
      name: 'Google',
      button: 'Sign in with Google',
      setup: () => {
        jest.spyOn(providers, 'isGoogleSignInAvailable').mockReturnValue(true);
        jest.spyOn(providers, 'signInWithGoogle').mockResolvedValue('google-id-token');
      },
      expected: { provider: 'google', id_token: 'google-id-token' },
    },
  ])('signs in with $name and opens home', async ({ button, setup, expected }) => {
    setup();
    const fetch = mockApi({ 'POST /auth/sign-in': signedIn(), 'GET /health': health });
    await openSignIn();

    await fireEvent.press(await screen.findByText(button));

    await screen.findByText('Signed in as user@example.com');
    expect(requestBody(fetch)).toEqual(expected);
    expect(screen).toHavePathname('/');
  });

  it('signs in as a developer with an email address', async () => {
    const fetch = mockApi({ 'POST /auth/sign-in': signedIn(), 'GET /health': health });
    await openSignIn();

    await fireEvent.changeText(screen.getByLabelText('Email address'), ' dev@example.com ');
    await fireEvent.press(screen.getByText('Sign in'));

    await screen.findByText('Signed in as user@example.com');
    expect(requestBody(fetch)).toEqual({ provider: 'dev', id_token: 'dev@example.com' });
  });

  it.each([
    {
      name: 'asks to verify the email when the provider has not (BR-ACC-07)',
      respond: json(403, { code: 'email_not_verified', message: '' }),
      expected: /isn't verified with this account/,
    },
    {
      name: 'says the API is unreachable when offline',
      respond: offline,
      expected: /Can't reach Lumei/,
    },
    {
      name: 'shows a general error when Apple fails',
      appleFails: true,
      respond: offline,
      expected: /Something went wrong/,
    },
  ])('$name', async ({ appleFails, respond, expected }) => {
    if (appleFails) {
      jest.mocked(AppleAuthentication.signInAsync).mockRejectedValue(new Error('Apple failed'));
    } else {
      jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
        identityToken: 'apple-id-token',
      } as AppleAuthentication.AppleAuthenticationCredential);
    }
    mockApi({ 'POST /auth/sign-in': respond });
    await openSignIn();

    await fireEvent.press(await screen.findByText('Sign in with Apple'));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen).toHavePathname('/sign-in');
  });

  it('does nothing when the user cancels Apple’s sheet', async () => {
    jest
      .mocked(AppleAuthentication.signInAsync)
      .mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));
    const fetch = mockApi({});
    await openSignIn();

    await fireEvent.press(await screen.findByText('Sign in with Apple'));

    await screen.findByText('Sign in');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hides Sign in with Apple where the device lacks it', async () => {
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(false);
    await openSignIn();

    expect(screen.queryByText('Sign in with Apple')).toBeNull();
  });
});
