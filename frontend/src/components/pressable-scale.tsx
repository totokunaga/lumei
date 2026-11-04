import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EASE_OUT } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const press = { duration: 120, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** Props of `PressableScale`: a `Pressable`'s, with children as nodes only. */
type PressableScaleProps = Omit<PressableProps, 'children'> & { children: ReactNode };

/**
 * Renders a `Pressable` that shrinks slightly while pressed and eases back
 * on release, without a bounce, on the UI thread. With Reduce Motion on, it
 * changes without animating.
 */
export function PressableScale({ children, onPressIn, onPressOut, ...props }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      {...props}
      style={[style, props.style as object]}
      onPressIn={(event) => {
        scale.set(withTiming(0.96, press));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withTiming(1, press));
        onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
