import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';

describe('PressableScale', () => {
  it.each([
    { name: 'press', event: 'press', handler: 'onPress' },
    { name: 'press in, as it starts shrinking', event: 'pressIn', handler: 'onPressIn' },
    { name: 'press out, as it springs back', event: 'pressOut', handler: 'onPressOut' },
  ] as const)('passes on the $name', async ({ event, handler }) => {
    const handlers = { onPress: jest.fn(), onPressIn: jest.fn(), onPressOut: jest.fn() };
    await render(
      <PressableScale accessibilityRole="button" {...handlers}>
        <Text>Save</Text>
      </PressableScale>,
    );

    await fireEvent(screen.getByRole('button', { name: 'Save' }), event);

    expect(handlers[handler]).toHaveBeenCalledTimes(1);
  });

  it.each([{ name: 'without handlers of its own' }])('presses in and out $name', async () => {
    await render(
      <PressableScale accessibilityRole="button">
        <Text>Save</Text>
      </PressableScale>,
    );
    const button = screen.getByRole('button', { name: 'Save' });

    await fireEvent(button, 'pressIn');
    await fireEvent(button, 'pressOut');

    expect(button).toBeOnTheScreen();
  });
});
