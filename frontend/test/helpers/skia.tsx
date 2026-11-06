// Stands in for @shopify/react-native-skia, which draws natively: the canvas
// is a plain view, shapes draw nothing, and paths keep their SVG data so
// tests can tell which countries a map highlights.
import type { ReactNode } from 'react';
import { View } from 'react-native';

/** Renders the canvas as a view, with its children, which render nothing. */
export const Canvas = ({ children }: { children?: ReactNode }) => <View>{children}</View>;

/** Renders a group's children; its transform and opacity aren't drawn. */
export const Group = ({ children }: { children?: ReactNode }) => <>{children}</>;

/** Draws nothing. */
export const Path = () => null;

/**
 * Builds a stand-in path that counts what was added, so tests can tell how
 * many bars a chart draws.
 * @returns A builder whose `detach` returns the counts.
 */
const makeBuilder = () => {
  const counts = { moves: 0, lines: 0, rrects: 0 };
  const builder = {
    moveTo: () => ((counts.moves += 1), builder),
    lineTo: () => ((counts.lines += 1), builder),
    addRRect: () => ((counts.rrects += 1), builder),
    detach: () => ({ ...counts }),
    build: () => ({ ...counts }),
  };
  return builder;
};

export const Skia = {
  PathBuilder: { Make: makeBuilder },
  /** Measures a stand-in path, which has no length: there are no contours. */
  ContourMeasureIter: () => ({ next: () => null }),
  /** @returns The rect's numbers. */
  XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
  /** @returns The rounded rect's numbers. */
  RRectXY: (rect: object, rx: number, ry: number) => ({ rect, rx, ry }),
  Path: {
    /**
     * Keeps the SVG data instead of parsing it, as Skia does for valid data.
     * @returns A stand-in path, or null for `""`, which Skia can't parse.
     */
    MakeFromSVGString: (svg: string) => (svg ? { svg } : null),
  },
};

/** Draws nothing. */
export const Image = () => null;

/**
 * Loads an image at once, as a stand-in object.
 * @returns A stand-in image.
 */
export const useImage = (source: number) => ({ source });

/** Draws nothing. */
export const Paint = () => null;

/** Draws nothing, as a view that keeps its props, so tests can tell which circles a chart draws. */
export const Circle = (props: object) => <View testID="skia-circle" {...props} />;

/** Draws nothing. */
export const DashPathEffect = () => null;

/** Draws nothing. */
export const Line = () => null;

/** @returns The point. */
export const vec = (x = 0, y = 0) => ({ x, y });
