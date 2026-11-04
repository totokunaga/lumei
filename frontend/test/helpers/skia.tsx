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

export const Skia = {
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

/** Draws nothing. */
export const Circle = () => null;
