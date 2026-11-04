import { fireEvent, render, screen } from '@testing-library/react-native';

import { MenuPicker as AndroidMenuPicker } from '@/components/menu-picker.android';
import { MenuPicker as IosMenuPicker } from '@/components/menu-picker.ios';

const options = [
  { value: 'jp', label: 'Japan' },
  { value: 'eu', label: 'European Union' },
];

describe('MenuPicker', () => {
  it('chooses an option from the system menu on iOS', async () => {
    const onChange = jest.fn();
    await render(<IosMenuPicker label="Region" options={options} value="jp" onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Japan' })).toBeSelected();
    await fireEvent.press(screen.getByText('European Union'));

    expect(onChange).toHaveBeenCalledWith('eu');
  });

  it('opens the dropdown, chooses an option, and closes it on Android', async () => {
    const onChange = jest.fn();
    await render(
      <AndroidMenuPicker label="Region" options={options} value="jp" onChange={onChange} />,
    );
    expect(screen.queryByRole('menuitem')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Japan ▾' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'European Union' }));

    expect(onChange).toHaveBeenCalledWith('eu');
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
