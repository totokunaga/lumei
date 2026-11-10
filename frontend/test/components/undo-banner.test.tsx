import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  offerUndo,
  SCREEN_READER_UNDO_MS,
  UNDO_MS,
  UndoBanner,
} from '@/components/undo-banner';
import i18n from '@/i18n';

const renderBanner = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <UndoBanner />
    </SafeAreaProvider>,
  );

describe('UndoBanner (BR-EXP-06)', () => {
  beforeAll(() => i18n.changeLanguage('en'));
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    { name: 'undoes and leaves when Undo is pressed', press: true, wait: 0, undone: 1 },
    { name: 'leaves on its own after a few seconds', press: false, wait: UNDO_MS, undone: 0 },
    { name: 'stays until then', press: false, wait: UNDO_MS - 100, undone: 0, stays: true },
    {
      name: 'stays longer while a screen reader is on, to reach Undo (BR-NFR-07)',
      screenReader: true,
      press: false,
      wait: SCREEN_READER_UNDO_MS - 100,
      undone: 0,
      stays: true,
    },
    {
      name: 'leaves after that longer time with a screen reader',
      screenReader: true,
      press: false,
      wait: SCREEN_READER_UNDO_MS,
      undone: 0,
    },
  ])('$name', async ({ screenReader = false, press, wait, undone, stays = false }) => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(screenReader);
    const undo = jest.fn();
    await renderBanner();

    await act(() => offerUndo({ message: 'Expense deleted', undo }));
    expect(screen.getByText('Expense deleted')).toBeOnTheScreen();
    if (press) {
      await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    }
    await act(() => jest.advanceTimersByTimeAsync(wait));

    expect(undo).toHaveBeenCalledTimes(undone);
    expect(screen.queryByText('Expense deleted') !== null).toBe(stays);
  });
});
