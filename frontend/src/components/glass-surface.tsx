import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { cssInterop } from 'nativewind';
import { type ReactNode, useEffect, useState } from 'react';
import { AccessibilityInfo, type StyleProp, View, type ViewStyle } from 'react-native';

// NativeWind styles only the components it knows; without this, `className`
// on the native GlassView is dropped, e.g. the classes that center its content.
cssInterop(GlassView, { className: 'style' });

/** Whether this device draws Liquid Glass at all (iOS 26 and later). */
const glassAvailable = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/**
 * Returns whether the user turned on Reduce Transparency, and follows changes.
 * @returns True while glass should give way to a solid surface.
 */
const useReduceTransparency = (): boolean => {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((value) => {
      if (active) {
        setReduce(value);
      }
    });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduce;
};

/** Props of `GlassSurface`. */
interface GlassSurfaceProps {
  children: ReactNode;
  /** Tints the glass, e.g. with the accent for the primary action. */
  tintColor?: string;
  /** Makes the glass react to touches, for things the user presses. */
  interactive?: boolean;
  /**
   * The classes of the solid surface used without glass (Android, older iOS,
   * or Reduce Transparency), e.g. a translucent fill with a hairline border.
   */
  fallbackClassName: string;
  /** Applies to both the glass and the solid surface, e.g. the shape. */
  style?: StyleProp<ViewStyle>;
  className?: string;
}

/**
 * Renders floating chrome in Liquid Glass where the device has it, and as a
 * solid surface otherwise: on Android, before iOS 26, and with Reduce
 * Transparency on (see the frontend's CLAUDE.md).
 */
export function GlassSurface({
  children,
  tintColor,
  interactive = false,
  fallbackClassName,
  style,
  className,
}: GlassSurfaceProps) {
  const reduceTransparency = useReduceTransparency();
  if (glassAvailable && !reduceTransparency) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tintColor}
        style={style}
        className={className}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={style} className={`${fallbackClassName} ${className ?? ''}`}>
      {children}
    </View>
  );
}
