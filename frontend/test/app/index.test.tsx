import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';
import i18n from '@/i18n';

const renderHome = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
};

describe('HomeScreen', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      name: 'the status the API reports',
      fetch: () => Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
      expected: 'API status: ok',
    },
    {
      name: 'that the API is unreachable when the request fails',
      fetch: () => Promise.reject(new TypeError('Network request failed')),
      expected: 'API unreachable',
    },
  ])('shows $name', async ({ fetch, expected }) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetch);

    await renderHome();

    expect(await screen.findByText(expected)).toBeOnTheScreen();
  });
});
