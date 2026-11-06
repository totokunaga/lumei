import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { TAB_BAR_CLEARANCE } from '@/lib/layout';

import { GlassSurface } from './glass-surface';
import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';

/** How long the banner offers to undo, in milliseconds. */
export const UNDO_MS = 5_000;

/** What the banner offers to undo. */
interface UndoOffer {
  /** Says what happened, e.g. "Expense deleted". */
  message: string;
  undo: () => void;
}

/** The offer on screen, or null. */
interface UndoState {
  offer: UndoOffer | null;
}

/**
 * Holds the undo offer on screen.
 * @returns The Zustand store hook.
 */
const useUndo = create<UndoState>()(() => ({ offer: null }));

/**
 * Shows the undo banner for `UNDO_MS`, replacing any offer already shown,
 * e.g. after deleting an expense (BR-EXP-06).
 */
export const offerUndo = (offer: UndoOffer): void => useUndo.setState({ offer });

/** Hides the undo banner. */
export const dismissUndo = (): void => useUndo.setState({ offer: null });

/**
 * Renders the undo banner above the tab bar and the quick-add button: what
 * happened and an "Undo" button, on Liquid Glass where the device has it. It
 * leaves after `UNDO_MS`, and screen readers announce it when it appears.
 */
export function UndoBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const offer = useUndo((s) => s.offer);

  useEffect(() => {
    if (!offer) {
      return;
    }
    AccessibilityInfo.announceForAccessibility(offer.message);
    const timer = setTimeout(dismissUndo, UNDO_MS);
    return () => clearTimeout(timer);
  }, [offer]);

  if (!offer) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(250).easing(EASE_OUT).reduceMotion(ReduceMotion.System)}
      exiting={FadeOutDown.duration(200).easing(EASE_OUT).reduceMotion(ReduceMotion.System)}
      pointerEvents="box-none"
      // Above the quick-add button, which sits over the tab bar.
      style={{ bottom: insets.bottom + TAB_BAR_CLEARANCE + 96 }}
      className="absolute left-6 right-6"
    >
      {/* Dark-tinted glass, so the white text reads over any content. */}
      <GlassSurface
        tintColor="#111827"
        fallbackClassName="bg-gray-900 dark:bg-gray-800"
        style={{ borderRadius: 20 }}
        className="flex-row items-center justify-between gap-4 py-2 pl-5 pr-2"
      >
        <View className="flex-shrink">
          <Text className="text-base font-medium text-white">{offer.message}</Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          onPress={() => {
            offer.undo();
            dismissUndo();
          }}
          className="h-11 items-center justify-center rounded-full px-4"
        >
          <Text className="text-base font-semibold text-emerald-400">{t('undo.undo')}</Text>
        </PressableScale>
      </GlassSurface>
    </Animated.View>
  );
}
