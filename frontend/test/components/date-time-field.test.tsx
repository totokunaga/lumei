import { render, screen } from '@testing-library/react-native';

import { DateTimeField } from '@/components/date-time-field.android';
import i18n from '@/i18n';

describe('DateTimeField on Android (BR-EXP-02, BR-NFR-07)', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('names each button with the field it sets, for TalkBack', async () => {
    const value = new Date(2026, 10, 9, 12, 30).getTime();
    await render(
      <DateTimeField
        label="Date and time"
        value={value}
        onChange={jest.fn()}
        min={new Date(2026, 9, 25)}
        max={new Date(2026, 10, 9, 23, 59)}
      />,
    );

    expect(screen.getByRole('button', { name: /^Date and time, Nov 9, 2026$/ })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: /^Date and time, 12:30\sPM$/ })).toBeOnTheScreen();
  });
});
