import type { ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const spring = { damping: 15, stiffness: 300, reduceMotion: ReduceMotion.System };

/** Props of `PressableScale`: a `Pressable`'s, with children as nodes only. */
type PressableScaleProps = Omit<PressableProps, 'children'> & { children: ReactNode };

/**
 * Renders a `Pressable` that shrinks slightly while pressed and springs back
 * on release, on the UI thread. With Reduce Motion on, it changes without
 * the spring.
 */
export function PressableScale({ children, onPressIn, onPressOut, ...props }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      {...props}
      style={[style, props.style as object]}
      onPressIn={(event) => {
        scale.set(withSpring(0.96, spring));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, spring));
        onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
