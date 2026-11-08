import { act, renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';

import { useScrollRoom } from '@/lib/scroll-room';

/** Builds a layout event of a height. */
const layout = (height: number) =>
  ({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } }) as LayoutChangeEvent;

// A 700-point list, with 60 points of padding above a 500-point header.
const VIEWPORT = 700;
const ABOVE = 60;
const HEADER = 500;

describe('useScrollRoom (BR-EXP-10)', () => {
  it.each([
    // Rows and padding below the header, in points.
    { name: 'room for the header to reach the top under few rows', below: 200, spacer: 500 },
    { name: 'no spacer under a screen of rows', below: 900, spacer: 0 },
  ])('leaves $name', async ({ below, spacer }) => {
    const { result } = await renderHook(() => useScrollRoom(ABOVE));
    await act(() => {
      result.current.onLayout(layout(VIEWPORT));
      result.current.onHeaderLayout(layout(HEADER));
    });

    // Before the rows change, a screen of room; then only what the rows leave.
    await act(() => result.current.hold());
    expect(result.current.spacer).toBe(VIEWPORT);
    await act(() =>
      result.current.onContentSizeChange(390, ABOVE + HEADER + below + result.current.spacer),
    );

    expect(result.current.spacer).toBe(spacer);
  });

  it('starts without a spacer, and doesn’t grow one when measured', async () => {
    const { result } = await renderHook(() => useScrollRoom(ABOVE));
    await act(() => {
      result.current.onLayout(layout(VIEWPORT));
      result.current.onHeaderLayout(layout(HEADER));
      result.current.onContentSizeChange(390, ABOVE + HEADER + 100);
    });

    expect(result.current.spacer).toBe(0);
  });
});
