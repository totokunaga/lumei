import { fireEvent, screen } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { renderRouter } from 'expo-router/testing-library';

import * as providers from '@/auth/providers';
import { useAuth } from '@/auth/store';
import i18n from '@/i18n';

import { finishedSetup } from '../helpers/account';
import { json, mockApi, offline, requestBody, signedIn, syncApi } from '../helpers/api';
import { routes } from '../helpers/routes';

// Apple's button is native; the stand-in is a plain button with its label.
jest.mock('expo-apple-authentication', () => require('../helpers/apple-authentication'));

/** Opens the app signed out, on the sign-in screen. */
const openSignIn = async () => {
  await renderRouter(routes, { initialUrl: '/sign-in' });
  await screen.findByText('Sign in');
};

describe('SignInScreen (BR-ACC-01)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(async () => {
    useAuth.setState({ status: 'restoring', session: null });
    // The account finished setup on an earlier sign-in, so signing in opens home.
    await finishedSetup();
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
          authorizationCode: 'apple-code',
        } as AppleAuthentication.AppleAuthenticationCredential),
      // The code lets the API revoke the sign-in when the account is deleted (BR-ACC-05).
      expected: { provider: 'apple', id_token: 'apple-id-token', authorization_code: 'apple-code' },
    },
    {
      name: 'Google',
      button: 'Sign in with Google',
      setup: () => {
        jest.spyOn(providers, 'isGoogleSignInAvailable').mockReturnValue(true);
        jest.spyOn(providers, 'signInWithGoogle').mockResolvedValue({
          idToken: 'google-id-token',
          authorizationCode: 'google-code',
        });
      },
      expected: {
        provider: 'google',
        id_token: 'google-id-token',
        authorization_code: 'google-code',
      },
    },
  ])('signs in with $name and opens home', async ({ button, setup, expected }) => {
    setup();
    const fetch = mockApi({ ...syncApi, 'POST /auth/sign-in': signedIn() });
    await openSignIn();

    await fireEvent.press(await screen.findByText(button));

    await screen.findByLabelText('Add expense');
    expect(requestBody(fetch)).toEqual(expected);
    expect(screen).toHavePathname('/');
  });

  it('signs in as a developer with an email address', async () => {
    const fetch = mockApi({ ...syncApi, 'POST /auth/sign-in': signedIn() });
    await openSignIn();

    await fireEvent.changeText(screen.getByLabelText('Email address'), ' dev@example.com ');
    await fireEvent.press(screen.getByText('Sign in'));

    await screen.findByLabelText('Add expense');
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
    mockApi({ ...syncApi, 'POST /auth/sign-in': respond });
    await openSignIn();

    await fireEvent.press(await screen.findByText('Sign in with Apple'));

    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
    expect(screen).toHavePathname('/sign-in');
  });

  it('does nothing when the user cancels Apple’s sheet', async () => {
    jest
      .mocked(AppleAuthentication.signInAsync)
      .mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));
    const fetch = mockApi({ ...syncApi });
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
