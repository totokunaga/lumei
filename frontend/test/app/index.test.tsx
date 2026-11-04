import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from '@/app/index';
import { openUserDatabase } from '@/db/client';
import i18n from '@/i18n';

import { finishedSetup } from '../helpers/account';
import { json, mockApi, offline, testUser } from '../helpers/api';

const renderHome = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>
        <HomeScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
};

describe('HomeScreen', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      name: 'the spending budget of the current period (BR-CALC-02)',
      overrides: {},
      health: json(200, { status: 'ok' }),
      expected: ['¥150,000', 'API status: ok'],
    },
    {
      name: 'a budget without income or a target when those steps were skipped',
      overrides: { incomes: [], savingTarget: null },
      health: json(200, { status: 'ok' }),
      expected: ['-¥100,000'],
    },
    {
      name: 'that the API is unreachable when the request fails',
      overrides: {},
      health: offline,
      expected: ['API unreachable'],
    },
  ])('shows $name', async ({ overrides, health, expected }) => {
    await finishedSetup(overrides);
    await openUserDatabase(testUser.id);
    mockApi({ 'GET /health': health });

    await renderHome();

    for (const text of expected) {
      expect(await screen.findByText(text)).toBeOnTheScreen();
    }
  });

  it('says so when no period covers today', async () => {
    await openUserDatabase(testUser.id);
    mockApi({ 'GET /health': json(200, { status: 'ok' }) });

    await renderHome();

    expect(await screen.findByText('No period covers today yet.')).toBeOnTheScreen();
  });
});
