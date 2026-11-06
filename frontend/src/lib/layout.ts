// Layout measurements the screens share.
import { Platform } from 'react-native';

/**
 * Roughly how much of the bottom of the screen, above the safe area, the
 * native tab bar covers: the iOS 26 floating tab bar, or Android's Material
 * navigation bar. Native tabs can't report their height, so content that
 * floats above the tab bar (the quick-add button) or must scroll clear of it
 * leaves this much room.
 */
export const TAB_BAR_CLEARANCE = Platform.OS === 'ios' ? 64 : 80;
