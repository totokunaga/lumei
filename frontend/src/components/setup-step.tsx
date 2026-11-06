import { SymbolView } from 'expo-symbols';
import { type ComponentRef, type ReactNode, type RefObject, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from './pressable-scale';

/** Props of `SetupStep`. */
interface SetupStepProps {
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
  /** Shows a close button beside the title, for a form opened as a sheet. */
  onClose?: () => void;
}

/**
 * Renders one setup step under setup's header (`SetupHeader`, in the setup
 * layout): the title and description, which stay in place, the step's
 * content in a scroll view under them,
 * and the continue and skip buttons, kept above the keyboard. When editing,
 * the primary button says "Done" and the step can't be skipped. When the
 * step opens, the content scrolls so `revealRef`'s view sits in the middle of
 * the screen, or as close as the content allows.
 */
export function SetupStep({
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
  onClose,
}: SetupStepProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

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
      {/* The title and description stay in place while the content scrolls, so
          a step opened scrolled down (e.g. to the selected currency) still says
          what it asks. */}
      <View className="gap-3 px-6 pb-4 pt-8">
        <View className="flex-row items-start justify-between gap-4">
          <Text
            accessibilityRole="header"
            className="flex-shrink text-4xl font-bold text-black dark:text-white"
          >
            {title}
          </Text>
          {onClose && (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('expense.close')}
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900"
            >
              <SymbolView name={{ ios: 'xmark', android: 'close' }} size={16} tintColor="#6B7280" />
            </PressableScale>
          )}
        </View>
        {description && (
          <Text className="text-lg leading-6 text-gray-500 dark:text-gray-400">{description}</Text>
        )}
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
        contentContainerClassName="gap-4 px-6 pb-6 pt-2"
      >
        {children}
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
