import { fireEvent, render, screen } from '@testing-library/react-native';

import { RegionMap } from '@/components/region-map';

describe('RegionMap (BR-SET-06)', () => {
  it.each([
    { name: 'a region’s countries', countries: ['JP'] },
    { name: 'the whole world, without countries', countries: [] },
  ])('draws $name once laid out, and moves on to another region', async ({ countries }) => {
    await render(<RegionMap countries={countries} label="Map showing Japan" />);
    const map = screen.getByRole('image', { name: 'Map showing Japan' });

    await fireEvent(map, 'layout', { nativeEvent: { layout: { width: 350, height: 220 } } });
    await screen.rerender(<RegionMap countries={['FR', 'DE']} label="Map showing the EU" />);

    expect(screen.getByRole('image', { name: 'Map showing the EU' })).toBeOnTheScreen();
  });
});

