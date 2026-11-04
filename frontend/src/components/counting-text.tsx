import { useEffect, useRef, useState } from 'react';
import { Text, type TextProps } from 'react-native';

import { EASE_OUT, useReduceMotion } from './motion';

/** How long a number takes to count to its new value, in milliseconds. */
const COUNT_DURATION = 450;

/**
 * Counts a number up or down to `target` when it changes, easing to a stop,
 * so an amount shows how it moved instead of jumping. It shows the first
 * value at once, and jumps when Reduce Motion is on. A change while counting
 * carries on from the number shown. With `options.from`, it counts from that
 * number instead: on first showing, and again each time `options.restart`
 * changes, e.g. each time a screen comes into focus.
 *
 * Text can't be animated on the UI thread, so this re-renders on each frame;
 * keep it to short texts like an amount.
 * @param target E.g. an amount in minor units.
 * @param options.from The number to count from, e.g. 0.
 * @param options.restart Counts from `from` again when it changes.
 * @param options.duration How long counting takes, in milliseconds.
 * @returns The whole number to show now, between the old value and `target`.
 */
export function useCountUp(target: number, options: CountOptions = {}): number {
  const { from: start, restart, duration = COUNT_DURATION } = options;
  const reduceMotion = useReduceMotion();
  const [shown, setShown] = useState(start ?? target);
  const current = useRef(start ?? target);
  const restarted = useRef(restart);

  useEffect(() => {
    if (start !== undefined && restart !== restarted.current) {
      restarted.current = restart;
      current.current = start;
    }
    const from = current.current;
    if (reduceMotion || from === target) {
      current.current = target;
      setShown(target);
      return;
    }
    let began: number | null = null;
    let frame = 0;
    /** Shows the number for this frame, and asks for the next until done. */
    const step = (now: number) => {
      began ??= now;
      const progress = Math.min((now - began) / duration, 1);
      current.current = Math.round(from + (target - from) * EASE_OUT(progress));
      setShown(current.current);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduceMotion, start, restart, duration]);

  return reduceMotion ? target : shown;
}

/** Options of `useCountUp`. */
export interface CountOptions {
  from?: number;
  restart?: unknown;
  duration?: number;
}

/** Props of `CountingText`: a `Text`'s, plus the number, how to write it, and how to count. */
interface CountingTextProps extends Omit<TextProps, 'children'>, CountOptions {
  /** E.g. an amount in minor units. */
  value: number;
  /** Writes the number, e.g. `(n) => formatMoney(n, 'JPY', 'en')`. */
  format: (value: number) => string;
}

/**
 * Renders a text that counts up or down to its new number when `value`
 * changes (see `useCountUp`), e.g. a total or a budget.
 */
export function CountingText({
  value,
  format,
  from,
  restart,
  duration,
  ...props
}: CountingTextProps) {
  return <Text {...props}>{format(useCountUp(value, { from, restart, duration }))}</Text>;
}
