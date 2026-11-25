import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { renderRouter } from 'expo-router/testing-library';
import { AccessibilityInfo, Alert } from 'react-native';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { useAuth } from '@/auth/store';
import { closeUserDatabase, type Database, database, openUserDatabase } from '@/db/client';
import { newId } from '@/db/ids';
import {
  addCategory,
  addExpense,
  readCategories,
  readManagedCategories,
  setCategoryArchived,
} from '@/db/records';
import { useLocalData } from '@/db/store';
import i18n from '@/i18n';

import { finishedSetup } from '../../../helpers/account';
import { json, mockApi, storedSessionFor, syncApi, testUser } from '../../../helpers/api';
import { routes } from '../../../helpers/routes';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

/**
 * Opens Settings › Categories for an account with the Japan set's Eat Out
 * and Konbini, after `prepare` changes its categories.
 */
const openCategories = async (prepare?: (db: Database) => void) => {
  await SecureStore.setItemAsync('lumei.session', JSON.stringify(storedSessionFor()));
  await finishedSetup();
  if (prepare) {
    prepare(await openUserDatabase(testUser.id));
    closeUserDatabase();
  }
  mockApi({ ...syncApi, 'GET /me': json(200, testUser) });
  await renderRouter(routes, { initialUrl: '/settings' });
  await fireEvent.press(await screen.findByLabelText(/^Categories, \d+ categor/));
  await screen.findByLabelText('🏪 Konbini');
};

/** Reads the active categories' names in order, and the archived ones'. */
const stored = () => {
  const { active, archived } = readManagedCategories(database());
  return { active: active.map((c) => c.name), archived: archived.map((c) => c.name) };
};

const save = () => screen.getByRole('button', { name: 'Save' });

/** Records an expense in Eat Out, the first category. */
const expenseInEatOut = (db: Database) => {
  const [eatOut] = readCategories(db);
  addExpense(
    db,
    { amount: 1200, categoryId: eatOut.id, spentAt: Date.now(), isBigPurchase: false },
    newId(),
    Date.now(),
  );
};

describe('CategoriesScreen (BR-CAT-02 to BR-CAT-05)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => {
    useAuth.setState({ status: 'restoring', session: null });
    useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false });
  });

  it('adds a category with an emoji and a name, last in the order (BR-CAT-02)', async () => {
    await openCategories();

    await fireEvent.press(screen.getByRole('button', { name: 'Add category' }));
    expect(await screen.findByText('New category')).toBeOnTheScreen();
    expect(save()).toBeDisabled();
    // Letters aren't an emoji; typing a second emoji replaces the first.
    await fireEvent.changeText(screen.getByLabelText('Emoji'), 'a');
    await fireEvent.changeText(screen.getByLabelText('Emoji'), '🍵☕');
    await fireEvent.changeText(screen.getByLabelText('Name'), '  Coffee ');
    await fireEvent.press(save());

    expect(await screen.findByLabelText('☕ Coffee')).toBeOnTheScreen();
    expect(stored()).toEqual({ active: ['Eat Out', 'Konbini', 'Coffee'], archived: [] });
  });

  it.each([
    { name: 'an active category’s', typed: 'eat out' },
    { name: 'an archived category’s', typed: ' COFFEE' },
  ])('won’t save $name name, ignoring case and spaces (BR-CAT-04)', async ({ typed }) => {
    await openCategories((db) => {
      const id = newId();
      addCategory(db, { name: 'Coffee', emoji: '☕' }, id, Date.now());
      setCategoryArchived(db, id, true, Date.now());
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Add category' }));
    await fireEvent.changeText(await screen.findByLabelText('Emoji'), '🍵');
    await fireEvent.changeText(screen.getByLabelText('Name'), typed);

    expect(screen.getByRole('alert')).toHaveTextContent(
      `You already have a category called “${typed.trim()}”, maybe archived.`,
    );
    expect(save()).toBeDisabled();
  });

  it('renames a category and changes its emoji, keeping its own name allowed (BR-CAT-02)', async () => {
    await openCategories();

    await fireEvent.press(screen.getByLabelText('🍔 Eat Out'));
    expect(await screen.findByText('Edit category')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'EAT OUT');
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Dining');
    await fireEvent.changeText(screen.getByLabelText('Emoji'), '🍣');
    await fireEvent.press(save());

    expect(await screen.findByLabelText('🍣 Dining')).toBeOnTheScreen();
    expect(stored().active).toEqual(['Dining', 'Konbini']);
  });

  it('archives a category with an undo, and unarchives it last in the order (BR-CAT-03)', async () => {
    await openCategories();

    await fireEvent.press(screen.getByLabelText('🍔 Eat Out'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Archive category' }));

    expect(await screen.findByText('Eat Out archived')).toBeOnTheScreen();
    expect(screen.getByLabelText('🍔 Eat Out, archived')).toBeOnTheScreen();
    expect(stored()).toEqual({ active: ['Konbini'], archived: ['Eat Out'] });
    expect(readCategories(database()).map((c) => c.name)).toEqual(['Konbini']);

    await fireEvent.press(screen.getByLabelText('🍔 Eat Out, archived'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Unarchive category' }));

    expect(await screen.findByLabelText('🍔 Eat Out')).toBeOnTheScreen();
    expect(stored()).toEqual({ active: ['Konbini', 'Eat Out'], archived: [] });
  });

  it('keeps the last active category from being archived (BR-CAT-03)', async () => {
    await openCategories();
    await fireEvent.press(screen.getByLabelText('🍔 Eat Out'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Archive category' }));
    await fireEvent.press(await screen.findByLabelText('🏪 Konbini'));

    expect(await screen.findByRole('button', { name: 'Archive category' })).toBeDisabled();
    expect(
      screen.getByText("Your last active category can't be archived or deleted."),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Delete category' })).toBeNull();
  });

  it('deletes a category no expense uses, and undoes it back in its place (BR-CAT-05)', async () => {
    await openCategories();

    await fireEvent.press(screen.getByLabelText('🍔 Eat Out'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete category' }));

    expect(await screen.findByText('Eat Out deleted')).toBeOnTheScreen();
    expect(screen.queryByLabelText('🍔 Eat Out')).toBeNull();
    expect(stored()).toEqual({ active: ['Konbini'], archived: [] });

    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByLabelText('🍔 Eat Out')).toBeOnTheScreen();
    expect(stored()).toEqual({ active: ['Eat Out', 'Konbini'], archived: [] });
  });

  it('deletes an archived category no expense uses (BR-CAT-05)', async () => {
    await openCategories((db) =>
      setCategoryArchived(db, readCategories(db)[0].id, true, Date.now()),
    );

    await fireEvent.press(screen.getByLabelText('🍔 Eat Out, archived'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete category' }));

    expect(await screen.findByText('Eat Out deleted')).toBeOnTheScreen();
    expect(stored()).toEqual({ active: ['Konbini'], archived: [] });
  });

  it.each([
    {
      name: 'archives it',
      choice: 'Archive category',
      expected: { active: ['Konbini'], archived: ['Eat Out'] },
    },
    {
      name: 'keeps it',
      choice: 'Cancel',
      expected: { active: ['Eat Out', 'Konbini'], archived: [] },
    },
  ])(
    'offers to archive a category with expenses instead of deleting it, and $name (BR-CAT-05)',
    async ({ choice, expected }) => {
      const alert = jest.spyOn(Alert, 'alert');
      await openCategories(expenseInEatOut);

      await fireEvent.press(screen.getByLabelText('🍔 Eat Out'));
      await fireEvent.press(await screen.findByRole('button', { name: 'Delete category' }));

      expect(alert).toHaveBeenCalledWith(
        'Eat Out has 1 expense',
        expect.stringContaining("A category with expenses can't be deleted."),
        expect.any(Array),
      );
      const buttons = alert.mock.calls[0][2]!;
      await act(async () => buttons.find((b) => b.text === choice)?.onPress?.());
      await waitFor(() => expect(stored()).toEqual(expected));
      alert.mockRestore();
    },
  );

  it('offers no deletion for an archived category with expenses (BR-CAT-05)', async () => {
    await openCategories((db) => {
      expenseInEatOut(db);
      setCategoryArchived(db, readCategories(db)[0].id, true, Date.now());
    });

    await fireEvent.press(screen.getByLabelText('🍔 Eat Out, archived'));

    expect(await screen.findByRole('button', { name: 'Unarchive category' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Delete category' })).toBeNull();
  });

  it.each([
    { name: 'down', label: '🍔 Eat Out', action: 'moveDown', said: '🍔 Eat Out, 2 of 2' },
    { name: 'up', label: '🏪 Konbini', action: 'moveUp', said: '🏪 Konbini, 1 of 2' },
  ])(
    'moves a category $name with a screen reader’s action, saying where it went (BR-CAT-02, BR-NFR-07)',
    async ({ label, action, said }) => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await openCategories();

      await fireEvent(screen.getByLabelText(label), 'accessibilityAction', {
        nativeEvent: { actionName: action },
      });

      expect(stored().active).toEqual(['Konbini', 'Eat Out']);
      expect(announce).toHaveBeenCalledWith(said);
      announce.mockRestore();
    },
  );

  it('moves a category dragged by its handle past another (BR-CAT-02)', async () => {
    await openCategories();
    const [eatOut] = readCategories(database());

    const drag = createGestureController(`reorder-${eatOut.id}`);
    await act(() => {
      drag.begin();
      drag.activate();
      drag.update({ translationY: 70 });
      drag.end({ translationY: 70 });
    });

    await waitFor(() => expect(stored().active).toEqual(['Konbini', 'Eat Out']));
  });
});
