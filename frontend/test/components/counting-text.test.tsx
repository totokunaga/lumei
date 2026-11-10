import { act, render, renderHook, screen } from '@testing-library/react-native';

import { CountingText, useCountUp } from '@/components/counting-text';
import * as motion from '@/components/motion';

describe('useCountUp', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(motion, 'useReduceMotion').mockReturnValue(false);
  });
  afterEach(() => jest.useRealTimers());

  /** Moves the clock on and runs the animation frames due. */
  const wait = async (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

  it('shows the first value at once', async () => {
    const { result } = await renderHook(() => useCountUp(500));
    expect(result.current).toBe(500);
  });

  it.each([
    { name: 'up', from: 1_000, to: 2_000 },
    { name: 'down', from: 2_000, to: 1_000 },
  ])('counts $name to a new value, easing to a stop', async ({ from, to }) => {
    const { result, rerender } = await renderHook(({ target }: { target: number }) => useCountUp(target), {
      initialProps: { target: from },
    });

    await rerender({ target: to });
    await wait(150);
    const midway = result.current;
    expect(Math.min(from, to) < midway && midway < Math.max(from, to)).toBe(true);
    // Ease-out: well past halfway a third of the way through.
    expect(Math.abs(midway - from)).toBeGreaterThan(Math.abs(to - from) / 2);

    await wait(500);
    expect(result.current).toBe(to);
  });

  it('carries on from the number shown when the value changes again', async () => {
    const { result, rerender } = await renderHook(({ target }: { target: number }) => useCountUp(target), {
      initialProps: { target: 0 },
    });
    await rerender({ target: 1_000 });
    await wait(150);
    const shown = result.current;

    await rerender({ target: 0 });
    await wait(16);
    expect(result.current).toBeLessThanOrEqual(shown);
    expect(result.current).toBeGreaterThan(0);

    await wait(500);
    expect(result.current).toBe(0);
  });

  it('counts from the given number at first, and again on each restart', async () => {
    const { result, rerender } = await renderHook(
      ({ restart }: { restart: number }) => useCountUp(1_000, { from: 0, restart }),
      { initialProps: { restart: 0 } },
    );
    expect(result.current).toBe(0);
    await wait(500);
    expect(result.current).toBe(1_000);

    await rerender({ restart: 1 });
    await wait(16);
    expect(result.current).toBeLessThan(1_000);
    await wait(500);
    expect(result.current).toBe(1_000);
  });

  it('jumps to the new value with Reduce Motion on', async () => {
    jest.spyOn(motion, 'useReduceMotion').mockReturnValue(true);
    const { result, rerender } = await renderHook(({ target }: { target: number }) => useCountUp(target), {
      initialProps: { target: 0 },
    });

    await rerender({ target: 1_000 });

    expect(result.current).toBe(1_000);
  });
});

describe('CountingText', () => {
  it('writes the number with its format', async () => {
    await render(<CountingText value={1234} format={(n) => `Total ${n}`} />);
    expect(screen.getByText('Total 1234')).toBeOnTheScreen();
  });
});

describe('CountingText (BR-NFR-07)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(motion, 'useReduceMotion').mockReturnValue(false);
  });
  afterEach(() => jest.useRealTimers());

  it('has screen readers read the new number while the shown one is still counting', async () => {
    await render(<CountingText value={1_000} from={0} format={(n) => `¥${n}`} />);
    await act(async () => void jest.advanceTimersByTime(100));

    expect(screen.getByLabelText('¥1000')).toBeOnTheScreen();
    expect(screen.queryByText('¥1000')).toBeNull();
  });
});
