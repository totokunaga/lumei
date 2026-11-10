import { useEffect, useState } from 'react';
import { Platform, Text, useColorScheme, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassSurface } from './glass-surface';
import type { MenuOption } from './menu-picker.types';
import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';

/** The selected segment's text: the system blue the native tab bar uses. */
const SELECTED = { light: '#007AFF', dark: '#0A84FF' } as const;

/** The gap between the pill's edge and the selected segment's highlight, in points. */
const INSET = 4;

const slide = { duration: 250, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** Props of `FloatingToggle`. */
interface FloatingToggleProps<T extends string> {
  /** What the toggle switches, for screen readers, e.g. "Show". */
  label: string;
  /** The segments, in order. */
  options: MenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Renders a toggle between a few views, styled like the floating tab bar: a
 * pill on Liquid Glass where the device has it, and solid white with a soft
 * shadow elsewhere. The selected segment sits on a light highlight, which
 * slides to a newly selected one, with its text in the tab bar's blue. Screen
 * readers read it as tabs, with the selected one marked.
 */
export function FloatingToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: FloatingToggleProps<T>) {
  const dark = useColorScheme() === 'dark';
  const [width, setWidth] = useState(0);
  const segment = width > 0 ? (width - INSET * 2) / options.length : 0;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const offset = useSharedValue(0);
  // Moves with transforms only, so it stays on the UI thread.
  useEffect(() => {
    offset.set(withTiming(index * segment, slide));
  }, [index, segment, offset]);
  const highlight = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  return (
    // Not interactive glass: held down, it brightens the whole pill and washes
    // out the highlight. The segments give their own press feedback.
    <GlassSurface
      fallbackClassName={`bg-white dark:bg-gray-900 ${
        Platform.OS === 'ios' ? 'shadow-lg shadow-black/10' : 'shadow-md'
      }`}
      style={{ borderRadius: 999 }}
    >
      <View
        accessibilityRole="tablist"
        accessibilityLabel={label}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ padding: INSET }}
        className="flex-row"
      >
        {segment > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[highlight, { width: segment, top: INSET, bottom: INSET, left: INSET }]}
            className="absolute rounded-full bg-black/5 dark:bg-white/10"
          />
        )}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <PressableScale
              key={option.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              className="min-h-11 flex-1 items-center justify-center rounded-full"
            >
              <Text
                style={selected ? { color: dark ? SELECTED.dark : SELECTED.light } : undefined}
                className={`text-base font-semibold ${selected ? '' : 'text-black dark:text-white'}`}
              >
                {option.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </GlassSurface>
  );
}
