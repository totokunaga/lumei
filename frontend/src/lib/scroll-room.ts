import { useCallback, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** What `useScrollRoom` returns: the spacer's height, and the handlers that keep it right. */
export interface ScrollRoom {
  /** The height of the spacer to put after the list's last row. */
  spacer: number;
  /** Makes room at once, in the same render as a change that can shorten the list. */
  hold: () => void;
  /** For the list's `onLayout`: measures the visible height. */
  onLayout: (event: LayoutChangeEvent) => void;
  /** For the list header's `onLayout`: measures its height, padding above it included. */
  onHeaderLayout: (event: LayoutChangeEvent) => void;
  /** For the list's `onContentSizeChange`: shrinks the spacer to what the rows leave. */
  onContentSizeChange: (width: number, height: number) => void;
}

/**
 * Keeps a list's header still when its rows change under it, e.g. when the
 * expense filter (BR-EXP-10) leaves fewer rows. A shorter list can't stay
 * scrolled as far, so the scroll view would pull the header down. A spacer
 * after the rows keeps enough room for the header to scroll to the top.
 * `hold` makes that room before the rows change, as the list's height would
 * otherwise drop for a frame; once the new rows are measured, the spacer
 * shrinks to only what they leave, and to nothing under a screen of rows.
 * @param above The list's padding above the header, in points.
 * @returns The spacer's height and its handlers; see `ScrollRoom`.
 */
export const useScrollRoom = (above: number): ScrollRoom => {
  const [spacer, setSpacer] = useState(0);
  const viewport = useRef(0);
  const header = useRef(0);

  const hold = useCallback(() => setSpacer(viewport.current), []);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    viewport.current = event.nativeEvent.layout.height;
  }, []);
  const onHeaderLayout = useCallback(
    (event: LayoutChangeEvent) => {
      header.current = above + event.nativeEvent.layout.height;
    },
    [above],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      // Room for the header to reach the top: the header and a screen below it.
      // `height` was measured with this render's spacer in it.
      const target = Math.max(0, header.current + viewport.current - (height - spacer));
      // Only shrink here: growing waits for `hold`, before the rows change.
      if (target < spacer) {
        setSpacer(target);
      }
    },
    [spacer],
  );

  return { spacer, hold, onLayout, onHeaderLayout, onContentSizeChange };
};
