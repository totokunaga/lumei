import { render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';

import { LocationMap } from '@/components/location-map';
import i18n from '@/i18n';

describe('LocationMap (BR-EXP-04)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  afterEach(() => jest.restoreAllMocks());

  it.each([
    { name: 'a map with the pin in a development build', environment: 'bare', map: true },
    { name: 'the coordinates in Expo Go, which has no map', environment: 'storeClient', map: false },
  ])('shows $name', async ({ environment, map }) => {
    jest.replaceProperty(Constants, 'executionEnvironment', environment as never);

    await render(<LocationMap location={{ latitude: 35.6812, longitude: 139.7671 }} onMove={jest.fn()} />);

    expect(screen.queryByTestId('map') !== null).toBe(map);
    expect(screen.getByLabelText('35.6812, 139.7671')).toBeOnTheScreen();
  });
});
