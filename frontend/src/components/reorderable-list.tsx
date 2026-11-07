import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type AccessibilityActionEvent, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { moveItem } from '@/domain/category';

import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';

/** Each row's height, and the gap between rows, in points. */
const ROW = 56;
const GAP = 8;
const STEP = ROW + GAP;

const ease = { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** Where each row sits: its ID's slot, from 0 at the top. */
type Slots = Record<string, number>;

/**
 * Numbers the rows in order.
 * @returns e.g. `{ a: 0, b: 1 }` for `['a', 'b']`.
 */
const slotsOf = (ids: readonly string[]): Slots =>
  Object.fromEntries(ids.map((id, index) => [id, index]));

/** Props of `ReorderableList`. */
interface ReorderableListProps<T extends { id: string }> {
  items: readonly T[];
  /** A row's content, beside its drag handle. */
  renderItem: (item: T) => ReactNode;
  /** What screen readers say for a row, e.g. "☕ Coffee". */
  itemLabel: (item: T) => string;
  onPressItem: (item: T) => void;
  /** Receives every row's ID in the new order, after the user moves one. */
  onReorder: (ids: string[]) => void;
}

/**
 * Renders rows the user reorders by dragging their handle, e.g. the
 * categories (BR-CAT-02). The held row lifts slightly and follows the
 * finger, and the others ease out of its way, with a haptic tick each time
 * it passes one; let go, it settles into its new place. Tapping a row
 * presses it. Screen readers move a row with its "Move up" and "Move down"
 * actions instead. Rows have a fixed height, and only transforms and
 * opacity animate.
 */
export function ReorderableList<T extends { id: string }>({
  items,
  renderItem,
  itemLabel,
  onPressItem,
  onReorder,
}: ReorderableListProps<T>) {
  const ids = items.map((item) => item.id);
  const key = ids.join(',');
  const slots = useSharedValue<Slots>(slotsOf(ids));
  // The rows' order after a save, or another device's change.
  useEffect(() => {
    slots.set(slotsOf(key.split(',')));
  }, [key, slots]);

  /** Moves a row one place, from a screen reader's action. */
  const move = (index: number, by: number) => {
    const to = index + by;
    if (to >= 0 && to < ids.length) {
      onReorder(moveItem(ids, index, to));
    }
  };

  return (
    <View style={{ height: Math.max(0, items.length * STEP - GAP) }}>
      {items.map((item, index) => (
        <Row
          key={item.id}
          id={item.id}
          index={index}
          count={items.length}
          slots={slots}
          label={itemLabel(item)}
          onPress={() => onPressItem(item)}
          onMove={(by) => move(index, by)}
          onDrop={onReorder}
        >
          {renderItem(item)}
        </Row>
      ))}
    </View>
  );
}

/** Props of `Row`. */
interface RowProps {
  id: string;
  index: number;
  count: number;
  slots: SharedValue<Slots>;
  label: string;
  children: ReactNode;
  onPress: () => void;
  /** Moves the row up (-1) or down (1) one place. */
  onMove: (by: number) => void;
  onDrop: (ids: string[]) => void;
}

/** Renders one row of `ReorderableList`, with the drag that moves it. */
function Row({ id, index, count, slots, label, children, onPress, onMove, onDrop }: RowProps) {
  const { t } = useTranslation();
  const offset = useSharedValue(index * STEP);
  const start = useSharedValue(0);
  const held = useSharedValue(false);
  const lift = useSharedValue(0);

  // A row not being held eases to its slot whenever the order changes.
  useAnimatedReaction(
    () => slots.get()[id],
    (slot, previous) => {
      if (slot !== undefined && slot !== previous && !held.get()) {
        offset.set(previous === null ? slot * STEP : withTiming(slot * STEP, ease));
      }
    },
  );

  const tick = () => void Haptics.selectionAsync();
  const grab = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  const pan = usePanGesture({
    testID: `reorder-${id}`,
    onActivate: () => {
      'worklet';
      held.set(true);
      start.set(offset.get());
      lift.set(withTiming(1, ease));
      scheduleOnRN(grab);
    },
    onUpdate: (event) => {
      'worklet';
      const y = Math.min(Math.max(0, start.get() + event.translationY), (count - 1) * STEP);
      offset.set(y);
      const current = slots.get();
      const from = current[id];
      const to = Math.round(y / STEP);
      if (from === undefined || to === from) {
        return;
      }
      // The rows between shift one place toward where the held row was.
      const next: Slots = {};
      for (const other of Object.keys(current)) {
        const slot = current[other];
        if (other === id) {
          next[other] = to;
        } else if (from < to && slot > from && slot <= to) {
          next[other] = slot - 1;
        } else if (to < from && slot >= to && slot < from) {
          next[other] = slot + 1;
        } else {
          next[other] = slot;
        }
      }
      slots.set(next);
      scheduleOnRN(tick);
    },
    onDeactivate: () => {
      'worklet';
      const current = slots.get();
      held.set(false);
      lift.set(withTiming(0, ease));
      offset.set(withTiming((current[id] ?? 0) * STEP, ease));
      if (current[id] !== Math.round(start.get() / STEP)) {
        const order = Object.keys(current).sort((a, b) => current[a] - current[b]);
        scheduleOnRN(onDrop, order);
      }
    },
  });

  const row = useAnimatedStyle(() => ({
    zIndex: held.get() ? 1 : 0,
    transform: [{ translateY: offset.get() }, { scale: 1 + 0.02 * lift.get() }],
  }));
  // A soft shadow under the held row; only its opacity animates.
  const shadow = useAnimatedStyle(() => ({ opacity: lift.get() }));

  /** Runs a screen reader's move action. */
  const act = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'moveUp') {
      onMove(-1);
    } else if (event.nativeEvent.actionName === 'moveDown') {
      onMove(1);
    }
  };

  return (
    <Animated.View style={[row, { position: 'absolute', left: 0, right: 0, height: ROW }]}>
      <Animated.View
        pointerEvents="none"
        style={shadow}
        className="absolute inset-0 rounded-2xl bg-white shadow-lg shadow-black/20 dark:bg-gray-800"
      />
      <View className="h-full flex-row items-center rounded-2xl bg-gray-100 dark:bg-gray-900">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityActions={[
            ...(index > 0 ? [{ name: 'moveUp', label: t('categories.moveUp') }] : []),
            ...(index < count - 1 ? [{ name: 'moveDown', label: t('categories.moveDown') }] : []),
          ]}
          onAccessibilityAction={act}
          onPress={onPress}
          className="h-full flex-1 flex-row items-center gap-3 pl-4"
        >
          {children}
        </PressableScale>
        <GestureDetector gesture={pan}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-full w-14 items-center justify-center"
          >
            <SymbolView
              name={{ ios: 'line.3.horizontal', android: 'drag_handle' }}
              size={18}
              tintColor="#9CA3AF"
            />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}
