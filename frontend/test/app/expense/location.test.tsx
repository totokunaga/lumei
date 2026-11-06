// Where an expense happened (BR-EXP-04, BR-NFR-01).
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';

import { useAuth } from '@/auth/store';
import { database } from '@/db/client';
import { expenses } from '@/db/schema';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup, savedExpenses } from '../../helpers/account';
import { json, mockApi, storedSessionFor, testUser } from '../../helpers/api';
import { routes } from '../../helpers/routes';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

const TOKYO = { latitude: 35.6812, longitude: 139.7671 };
const SHIBUYA = { latitude: 35.658, longitude: 139.7016 };

/** Lets the location be read this once, as if the user allowed it. */
const allowLocation = (asked: boolean) => {
  const location = jest.mocked(Location);
  if (asked) {
    location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' } as never);
    location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
  } else {
    location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
  }
  location.getLastKnownPositionAsync.mockResolvedValueOnce({ coords: TOKYO } as never);
};

/** Opens the app on home, offline so nothing syncs. */
const openHome = async () => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  mockApi({ 'GET /me': json(200, testUser) });
};

/** Records ¥500 for Eat Out on the open sheet. */
const record = async () => {
  await fireEvent.changeText(screen.getByLabelText('Amount'), '500');
  await fireEvent.press(screen.getByText('Eat Out'));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(database().select().from(expenses).all()).toHaveLength(1));
  return database().select().from(expenses).get()!;
};

describe('Expense location (BR-EXP-04)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
    for (const read of [
      Location.getForegroundPermissionsAsync,
      Location.requestForegroundPermissionsAsync,
      Location.getLastKnownPositionAsync,
    ]) {
      jest.mocked(read).mockClear();
    }
  });

  it('asks for access the first time, then saves where the expense was recorded', async () => {
    await openHome();
    allowLocation(true);
    await renderRouter(routes, { initialUrl: '/expense/new' });

    expect(await screen.findByTestId('map')).toHaveProp('markers', [
      expect.objectContaining({ coordinates: TOKYO }),
    ]);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

    expect(await record()).toMatchObject(TOKYO);
  });

  it('moves the pin to where the map is tapped', async () => {
    await openHome();
    allowLocation(false);
    await renderRouter(routes, { initialUrl: '/expense/new' });

    await fireEvent(await screen.findByTestId('map'), 'mapClick', { coordinates: SHIBUYA });

    expect(await record()).toMatchObject(SHIBUYA);
  });

  it('saves no location once it is removed', async () => {
    await openHome();
    allowLocation(false);
    await renderRouter(routes, { initialUrl: '/expense/new' });

    await screen.findByTestId('map');
    await fireEvent.press(screen.getByText('Remove location'));

    expect(screen.queryByTestId('map')).toBeNull();
    expect(await record()).toMatchObject({ latitude: null, longitude: null });
  });

  it('works without access, saying it is off, and saves no location', async () => {
    await openHome();
    await renderRouter(routes, { initialUrl: '/expense/new' });

    expect(await screen.findByText(/Location access is off/)).toBeOnTheScreen();
    expect(await record()).toMatchObject({ latitude: null, longitude: null });
  });

  it('keeps a saved expense’s location when editing, and reads nothing on its own (BR-NFR-01)', async () => {
    await openHome();
    const [id] = await savedExpenses([{ amount: 800, date: '2026-11-05' }]);
    const db = await (await import('@/db/client')).openUserDatabase(testUser.id);
    db.update(expenses).set(SHIBUYA).run();
    await renderRouter(routes, { initialUrl: `/expense/${id}` });

    expect(await screen.findByTestId('map')).toHaveProp('markers', [
      expect.objectContaining({ coordinates: SHIBUYA }),
    ]);
    expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Remove location'));
    allowLocation(false);
    await fireEvent.press(screen.getByText('Add current location'));
    await screen.findByTestId('map');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(database().select().from(expenses).get()).toMatchObject(TOKYO),
    );
  });
});
