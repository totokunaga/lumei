import { SETUP_STEPS, stepIndex } from '@/components/setup-header';

describe('stepIndex (BR-ACC-06)', () => {
  it.each([
    { pathname: '/setup', expected: 0 },
    { pathname: '/setup/', expected: 0 },
    { pathname: '/setup/currency', expected: 1 },
    { pathname: '/setup/confirm', expected: SETUP_STEPS.length - 1 },
    { pathname: '/setup/unknown', expected: 0 },
  ])('finds step $expected for $pathname', ({ pathname, expected }) => {
    expect(stepIndex(pathname)).toBe(expected);
  });
});
