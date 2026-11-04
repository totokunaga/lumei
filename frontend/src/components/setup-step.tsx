import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { type ComponentRef, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EASE_OUT, riseIn } from './motion';
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

/** One step of setup. */
export type SetupStepName = (typeof SETUP_STEPS)[number];

/** Props of `SetupStep`. */
interface SetupStepProps {
  step: SetupStepName;
  title: string;
  description?: string;
  children: ReactNode;
  /** The primary button's label; "Continue" when omitted, or "Done" when editing. */
  continueLabel?: string;
  /** Disables the primary button, e.g. until a choice is made. */
  continueDisabled?: boolean;
  /** Shows a spinner instead of the primary button's label. */
  busy?: boolean;
  onContinue: () => void;
  /** Offers "Skip for now" when set: every step but region and currency can be skipped (BR-ACC-06). */
  onSkip?: () => void;
  /**
   * Shows the step opened from the confirm step to change one choice: the
   * primary button says "Done", and there is no "Skip for now".
   */
  editing?: boolean;
  /** Rendered between the content and the buttons, e.g. a notice that must stay in view. */
  footer?: ReactNode;
  /** A view in the content to scroll into view when the step opens, e.g. the selected option. */
  revealRef?: RefObject<ComponentRef<typeof View> | null>;
}

const progressTiming = { duration: 350, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/**
 * Renders one setup step: a back button and a progress bar that slides to
 * the step's position, the title and description, the step's content in a
 * scroll view, and the continue and skip buttons, kept above the keyboard.
 * The content rises into place when the step opens; with Reduce Motion on, it
 * only fades. When editing, the primary button says "Done" and the step
 * can't be skipped. When the step opens, the content scrolls so `revealRef`'s view
 * sits in the middle of the screen, or as close as the content allows.
 */
export function SetupStep({
  step,
  title,
  description,
  children,
  continueLabel,
  continueDisabled = false,
  busy = false,
  onContinue,
  onSkip,
  editing = false,
  footer,
  revealRef,
}: SetupStepProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const index = SETUP_STEPS.indexOf(step);

  // The bar starts at the previous step's position and slides forward.
  const progress = useSharedValue(index / SETUP_STEPS.length);
  useEffect(() => {
    progress.set(withTiming((index + 1) / SETUP_STEPS.length, progressTiming));
  }, [index, progress]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const revealed = useRef(false);

  /**
   * Scrolls `revealRef`'s view to the middle of the scroll view, once, as soon
   * as the scroll view and its content have been laid out. It jumps rather
   * than animates, so the step opens already in place.
   */
  const reveal = () => {
    const target = revealRef?.current;
    const inner = scrollRef.current?.getInnerViewRef();
    if (
      revealed.current ||
      !target ||
      !inner ||
      !viewportHeight.current ||
      !contentHeight.current
    ) {
      return;
    }
    revealed.current = true;
    target.measureLayout(inner, (_x, y, _width, height) => {
      const max = Math.max(0, contentHeight.current - viewportHeight.current);
      const centered = y + height / 2 - viewportHeight.current / 2;
      scrollRef.current?.scrollTo({ y: Math.min(max, Math.max(0, centered)), animated: false });
    });
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-white dark:bg-black">
      <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center gap-3 px-5">
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
          accessibilityLabel={t('setup.progress', {
            step: index + 1,
            total: SETUP_STEPS.length,
          })}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-900"
        >
          <Animated.View
            style={[{ transformOrigin: 'left' }, barStyle]}
            className="h-full w-full rounded-full bg-emerald-500"
          />
        </View>
        <View className="h-11 w-11" />
      </View>

      <ScrollView
        ref={scrollRef}
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
          reveal();
        }}
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
          reveal();
        }}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-6 px-6 pb-6 pt-8"
      >
        <Animated.View entering={riseIn()} className="gap-3">
          <Text
            accessibilityRole="header"
            className="text-4xl font-bold text-black dark:text-white"
          >
            {title}
          </Text>
          {description && (
            <Text className="text-lg leading-6 text-gray-500 dark:text-gray-400">
              {description}
            </Text>
          )}
        </Animated.View>
        <Animated.View entering={riseIn(80)} className="gap-4">
          {children}
        </Animated.View>
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + 12 }} className="gap-2 px-6 pt-3">
        {footer}
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: continueDisabled || busy }}
          disabled={continueDisabled || busy}
          onPress={onContinue}
          className={`h-14 items-center justify-center rounded-2xl ${
            continueDisabled ? 'bg-gray-200 dark:bg-gray-800' : 'bg-emerald-500'
          }`}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text
              className={`text-lg font-semibold ${
                continueDisabled ? 'text-gray-400 dark:text-gray-600' : 'text-white'
              }`}
            >
              {continueLabel ?? (editing ? t('setup.done') : t('setup.continue'))}
            </Text>
          )}
        </PressableScale>
        {onSkip && !editing && (
          <PressableScale
            accessibilityRole="button"
            onPress={onSkip}
            className="h-12 items-center justify-center"
          >
            <Text className="text-base font-medium text-gray-500 dark:text-gray-400">
              {t('setup.skip')}
            </Text>
          </PressableScale>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
