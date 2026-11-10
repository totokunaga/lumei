import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';

/** How far a short swipe opens the row: the width of the delete button, in points. */
const ACTION_WIDTH = 76;

/** How much of the row's width a swipe must pass, and be let go past, to delete at once. */
const FULL_SWIPE = 0.5;

const ease = { duration: 220, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** Closes the row left open, so only one is open at a time. */
let closeOpenRow: (() => void) | null = null;

/** What a row's owner can do with its swipe. */
export interface SwipeControls {
  /** Whether the row is swiped open, read at once from its position. */
  isOpen: () => boolean;
  /** Slides it back closed. */
  close: () => void;
}

/** Props of `SwipeToDelete`. */
interface SwipeToDeleteProps {
  children: ReactNode;
  /** Identifies the row, so a recycled row starts closed. */
  rowKey: string;
  onDelete: () => void;
  /**
   * Receives the row's controls, so a tap on an open row can close it
   * instead of acting.
   */
  controlsRef: { current: SwipeControls | null };
  /**
   * The row's background, behind the delete button too, and its shape, e.g.
   * the rounded corners of the first row of a card.
   */
  className?: string;
}

/**
 * Lets a list row be swiped left to delete it (BR-EXP-06). A short swipe
 * reveals a round delete button, which fades in and grows as the swipe
 * uncovers it; a swipe past half the row deletes it when let go, with a
 * haptic as it passes that point. Either way, the row slides off and fades
 * out before it is deleted. Swiping right, or a tap on the
 * row, closes it. Only one row is open at a time, and vertical scrolling
 * still works. The row moves with eased timing, never a spring.
 */
export function SwipeToDelete({
  children,
  rowKey,
  onDelete,
  controlsRef,
  className = 'bg-white dark:bg-black',
}: SwipeToDeleteProps) {
  const { t } = useTranslation();
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  const width = useSharedValue(0);
  const past = useSharedValue(false);
  /** Where the row comes to rest once it stops sliding: 0 when closed. */
  const resting = useSharedValue(0);
  /** 1 while the row shows; eases to 0 as a deleted row leaves. */
  const shown = useSharedValue(1);
  // Screen readers reach the delete button only while it shows; closed rows
  // offer deleting as an action instead (BR-NFR-07).
  // Held with the row's key: a recycled row shows another item, which starts closed.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const revealed = revealedKey === rowKey;

  // Made once, so the one open row can be recognized and closed from another.
  const { record: setOpen, slideClosed: close } = useMemo(() => {
    /** Records whether the row is open, and closes another row when this one opens. */
    const record = (open: boolean) => {
      setRevealedKey(open ? rowKey : null);
      if (open) {
        if (closeOpenRow && closeOpenRow !== slideClosed) {
          closeOpenRow();
        }
        closeOpenRow = slideClosed;
      } else if (closeOpenRow === slideClosed) {
        closeOpenRow = null;
      }
    };
    /** Slides the row back closed. */
    const slideClosed = () => {
      resting.set(0);
      offset.set(withTiming(0, ease));
      record(false);
    };
    return { record, slideClosed };
  }, [offset, resting, rowKey]);

  useEffect(() => {
    controlsRef.current = { isOpen: () => resting.get() < 0, close };
  }, [controlsRef, resting, close]);

  // A recycled row shows another item, which starts closed and shown.
  useEffect(() => {
    offset.set(0);
    resting.set(0);
    shown.set(1);
  }, [rowKey, offset, resting, shown]);

  /**
   * Slides the row off to the left and fades it out, then deletes it, so it
   * leaves rather than vanishing. Runs on the UI thread.
   */
  const leave = () => {
    'worklet';
    resting.set(-width.get());
    shown.set(withTiming(0, ease));
    offset.set(
      withTiming(-width.get(), ease, (finished) => {
        if (finished) {
          scheduleOnRN(onDelete);
        }
      }),
    );
  };

  const tick = () => void Haptics.selectionAsync();

  const pan = usePanGesture({
    testID: `swipe-${rowKey}`,
    // Horizontal only, so the list still scrolls vertically.
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onActivate: () => {
      'worklet';
      start.set(offset.get());
    },
    onUpdate: (event) => {
      'worklet';
      const next = Math.min(0, start.get() + event.translationX);
      offset.set(next);
      const beyond = width.get() > 0 && -next > width.get() * FULL_SWIPE;
      if (beyond !== past.get()) {
        past.set(beyond);
        scheduleOnRN(tick);
      }
    },
    onDeactivate: (event) => {
      'worklet';
      const current = offset.get();
      past.set(false);
      if (width.get() > 0 && -current > width.get() * FULL_SWIPE) {
        leave();
      } else if (current < -ACTION_WIDTH / 2 || event.velocityX < -500) {
        resting.set(-ACTION_WIDTH);
        offset.set(withTiming(-ACTION_WIDTH, ease));
        scheduleOnRN(setOpen, true);
      } else {
        resting.set(0);
        offset.set(withTiming(0, ease));
        scheduleOnRN(setOpen, false);
      }
    },
  });

  const row = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateX: offset.get() }],
  }));
  // The delete button fades in, and grows a little, as the swipe uncovers it.
  const button = useAnimatedStyle(() => {
    const uncovered = Math.min(1, Math.max(0, -offset.get() / ACTION_WIDTH));
    return {
      opacity: uncovered * shown.get(),
      transform: [{ scale: 0.6 + 0.4 * uncovered }],
    };
  });

  return (
    <View
      testID={`swipe-row-${rowKey}`}
      className={`overflow-hidden ${className}`}
      onLayout={(event) => width.set(event.nativeEvent.layout.width)}
    >
      {/* The round delete button, behind the row's right end; only transforms and opacity animate. */}
      <View
        pointerEvents="box-none"
        accessibilityElementsHidden={!revealed}
        importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
        style={{ width: ACTION_WIDTH }}
        className="absolute bottom-0 right-0 top-0 items-center justify-center"
      >
        <Animated.View style={button}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('expense.delete')}
            onPress={() => scheduleOnUI(leave)}
            className="h-11 w-11 items-center justify-center rounded-full bg-red-500"
          >
            <SymbolView
              name={{ ios: 'trash.fill', android: 'delete' }}
              size={18}
              tintColor="#FFFFFF"
            />
          </PressableScale>
        </Animated.View>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={row} className={className}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Closes the open row, if any, e.g. when the user taps it.
 * @returns True if a row was open.
 */
export const closeSwipedRow = (): boolean => {
  const close = closeOpenRow;
  close?.();
  return close !== null;
};
