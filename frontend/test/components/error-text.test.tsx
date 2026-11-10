import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { ErrorText } from '@/components/error-text';

describe('ErrorText (BR-NFR-07)', () => {
  afterEach(() => jest.restoreAllMocks());

  // Jest runs as iOS. Android reads the message through its live region instead.
  it.each([{ name: 'announces it on iOS, which has no live regions' }])('$name', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await render(<ErrorText>The expense couldn't be saved.</ErrorText>);

    expect(screen.getByRole('alert')).toHaveTextContent("The expense couldn't be saved.");
    expect(announce).toHaveBeenCalledWith("The expense couldn't be saved.");
  });

  it('announces a new message again', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { rerender } = await render(<ErrorText>First</ErrorText>);

    await rerender(<ErrorText>Second</ErrorText>);

    expect(announce).toHaveBeenLastCalledWith('Second');
  });
});
