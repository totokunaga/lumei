import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { useReduceMotion } from './motion';
import { PressableScale } from './pressable-scale';

/** The space between two cards, in points. */
const GAP = 12;

/** The list's side padding, which the pager scrolls past, edge to edge. */
const SIDE = 24;

/** One card of `CardPager`. */
export interface CardPage {
  key: string;
  /** Names the card for its page dot, e.g. "Chart". */
  label: string;
  card: ReactNode;
}

/** Props of `CardPager`. */
interface CardPagerProps {
  pages: CardPage[];
}

/**
 * Renders cards side by side, one at a time, which the user swipes between,
 * e.g. the chart and spending by category on home. It starts on the first;
 * swiping left shows the next, which snaps into place. The cards scroll from
 * the screen's edges and line up with the list's padding. Every card takes
 * the first one's height, which follows the screen's size; a later card fills
 * it, scrolling its own content if needed. Dots under them show which card is in view, and the
 * active one's fill follows the swipe; each dot is a button that shows its
 * card, so screen readers can switch too.
 */
export function CardPager({ pages }: CardPagerProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  // The screen's width less the list's padding until the pager is laid out.
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width - SIDE * 2);
  const [current, setCurrent] = useState(0);
  // The first card's height, which every card takes.
  const [height, setHeight] = useState<number | null>(null);
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0);
  const step = width + GAP;

  const onScroll = useAnimatedScrollHandler((event) => {
    offset.set(event.contentOffset.x);
  });

  /** Shows a card, scrolling to it. */
  const show = (index: number) => {
    scroller.current?.scrollTo({ x: index * step, animated: !reduceMotion });
    setCurrent(index);
  };

  return (
    <View className="gap-3" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Animated.ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={step > 0 ? step : undefined}
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(event) =>
          step > 0 && setCurrent(Math.round(event.nativeEvent.contentOffset.x / step))
        }
        style={{ marginHorizontal: -SIDE }}
        contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP, alignItems: 'flex-start' }}
      >
        {pages.map((page, index) =>
          index === 0 ? (
            // The first card sets the height, so it is laid out at its own.
            <View
              key={page.key}
              style={{ width }}
              onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            >
              {page.card}
            </View>
          ) : (
            // The others fill that height; until it is known they are out of view, so none shows.
            <View key={page.key} style={{ width, height: height ?? 0 }} className="overflow-hidden">
              {page.card}
            </View>
          ),
        )}
      </Animated.ScrollView>
      <View className="flex-row justify-center gap-1">
        {pages.map((page, index) => (
          <PressableScale
            key={page.key}
            accessibilityRole="button"
            accessibilityLabel={t('home.showCard', { card: page.label })}
            accessibilityState={{ selected: index === current }}
            onPress={() => show(index)}
            hitSlop={8}
            className="h-4 w-4 items-center justify-center"
          >
            <Dot index={index} offset={offset} step={step} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

/** Renders one page dot, filled as its card comes into view. */
function Dot({
  index,
  offset,
  step,
}: {
  index: number;
  offset: SharedValue<number>;
  step: number;
}) {
  const fill = useAnimatedStyle(() => {
    const distance = step > 0 ? Math.abs(offset.get() / step - index) : index;
    return { opacity: 0.25 + 0.75 * Math.max(0, 1 - distance) };
  });
  return (
    <Animated.View style={fill} className="h-2 w-2 rounded-full bg-gray-800 dark:bg-gray-200" />
  );
}
