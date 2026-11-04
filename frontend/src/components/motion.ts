import {
  Easing,
  FadeInDown,
  LinearTransition,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';

// Lumei's motion eases to a stop and never overshoots: no springs, so nothing
// bounces. Every animation follows Reduce Motion (ReduceMotion.System).

/** The easing of every animation: fast at first, settling gently. */
export const EASE_OUT = Easing.out(Easing.cubic);

/**
 * Builds a block's entrance: it rises a little into place while fading in.
 * With Reduce Motion on, it only fades.
 * @param delay Milliseconds to wait first, to stagger blocks one after another.
 * @returns A Reanimated `entering` animation.
 */
export const riseIn = (delay = 0) =>
  FadeInDown.duration(300).easing(EASE_OUT).delay(delay).reduceMotion(ReduceMotion.System);

/** Moves list rows to their new place when a row is added or removed. */
export const listLayout = LinearTransition.duration(250)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

/** The easing of camera moves, which travel far: slow to start and to stop. */
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/**
 * Reads whether the user has asked the system to reduce motion, as
 * Reanimated's `useReducedMotion` does. Tests replace it (see test/setup.ts).
 * @returns True if animations should be replaced by an immediate change.
 */
export const useReduceMotion = (): boolean => useReducedMotion();
