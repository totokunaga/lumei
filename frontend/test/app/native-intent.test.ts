import { redirectSystemPath } from '@/app/+native-intent';

describe('redirectSystemPath (BR-ACC-01)', () => {
  it.each([
    {
      name: 'the sign-in screen for Apple’s web result',
      path: 'lumei://apple-callback?code=c-1&id_token=t&state=s',
      expected: '/sign-in',
    },
    { name: 'the sign-in screen for the bare return link', path: 'lumei://apple-callback', expected: '/sign-in' },
    { name: 'any other link as it is', path: 'lumei://settings/delete-account', expected: 'lumei://settings/delete-account' },
    { name: 'a path as it is', path: '/settings', expected: '/settings' },
  ])('opens $name', ({ path, expected }) => {
    expect(redirectSystemPath({ path, initial: false })).toBe(expected);
  });
});
