import { apiBaseUrl } from '@/api/client';

describe('apiBaseUrl (BR-NFR-03)', () => {
  it.each([
    {
      name: 'the configured HTTPS URL in a release build',
      url: 'https://api.example.com',
      dev: false,
      expected: 'https://api.example.com',
    },
    {
      name: 'a plain-HTTP URL in development',
      url: 'http://10.0.2.2:18080',
      dev: true,
      expected: 'http://10.0.2.2:18080',
    },
    {
      name: 'the local API in development without a URL',
      url: undefined,
      dev: true,
      expected: 'http://localhost:18080',
    },
  ])('returns $name', ({ url, dev, expected }) => {
    expect(apiBaseUrl(url, dev)).toBe(expected);
  });

  it.each([
    { name: 'a plain-HTTP URL', url: 'http://api.example.com' },
    { name: 'no URL', url: undefined },
  ])('refuses $name in a release build', ({ url }) => {
    expect(() => apiBaseUrl(url, false)).toThrow('must be an https:// URL');
  });
});
