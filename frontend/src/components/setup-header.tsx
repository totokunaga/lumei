import { usePathname, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';

/** The setup steps in order (BR-ACC-06), as routes under `/setup`. */
export const SETUP_STEPS = [
  'index',
  'currency',
  'start-day',
  'income',
  'fixed-expenses',
  'target',
  'confirm',
] as const;

const progressTiming = { duration: 400, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/**
 * Works out which setup step a route is.
 * @returns The step's position in `SETUP_STEPS`, e.g. 1 for `/setup/currency`,
 *   or 0 for `/setup` and any route that isn't a step.
 */
export const stepIndex = (pathname: string): number =>
  Math.max(
    (SETUP_STEPS as readonly string[]).indexOf(pathname.replace(/^\/setup\/?/, '') || 'index'),
    0,
  );

/**
 * Renders setup's header, which stays in place while the steps slide in and
 * out under it: a back button from the second step on, and a progress bar
 * that slides forward or back to the current step's position, on the UI
 * thread (BR-ACC-06). With Reduce Motion on, the bar jumps.
 */
export function SetupHeader() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const index = stepIndex(usePathname());

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withTiming((index + 1) / SETUP_STEPS.length, progressTiming));
  }, [index, progress]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  return (
    <View
      style={{ paddingTop: insets.top + 8 }}
      className="flex-row items-center gap-3 bg-white px-5 dark:bg-black"
    >
      <View className="h-11 w-11">
        {index > 0 && (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('setup.back')}
            onPress={() => router.back()}
            className="h-11 w-11 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900"
          >
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back' }}
              size={18}
              tintColor="#8E8E93"
            />
          </PressableScale>
        )}
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('setup.progress', { step: index + 1, total: SETUP_STEPS.length })}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900"
      >
        <Animated.View
          style={[{ transformOrigin: 'left' }, barStyle]}
          className="h-full w-full rounded-full bg-emerald-500"
        />
      </View>
      <View className="h-11 w-11" />
    </View>
  );
}
