// Layout measurements the screens share.
import { Platform } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

/**
 * Roughly how much of the bottom of the screen, above the safe area, the
 * native tab bar covers: the iOS 26 floating tab bar, or Android's Material
 * navigation bar. Native tabs can't report their height, so content that
 * must scroll clear of it, or floats above it (the quick-add button on Android),
 * leaves this much room.
 */
export const TAB_BAR_CLEARANCE = Platform.OS === 'ios' ? 64 : 80;

/**
 * Works out how far above the bottom of the screen a floating button sits.
 * On iOS 26, at the side of the floating tab bar, raised by 1.5 times the bar's
 * height from centered on it: the bar is a capsule about 62 points tall, its bottom
 * edge about 12 points below the safe area. On Android, whose navigation bar
 * spans the width, just above the bar.
 * On iOS it measures from the device's own inset (the home indicator's), as a
 * tab's safe area also takes in the tab bar.
 * @param insetBottom The bottom safe-area inset where the button is, in points.
 * @param size The button's height, in points.
 * @returns The button's `bottom`, e.g. 114 for a 64-point button on an iPhone 17 Pro.
 */
export const floatingButtonBottom = (insetBottom: number, size: number): number =>
  Platform.OS === 'ios'
    ? Math.max(8, (initialWindowMetrics?.insets.bottom ?? insetBottom) - 12) +
      (62 - size) / 2 +
      62 * 1.5
    : insetBottom + TAB_BAR_CLEARANCE + 4;
