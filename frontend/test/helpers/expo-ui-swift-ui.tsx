// Stands in for @expo/ui/swift-ui, whose views are native: a picker renders
// its options as radio buttons, so tests choose one by its label as a user
// picks it from the menu.
import { createContext, type ReactNode, useContext } from 'react';
import { Text as NativeText, View } from 'react-native';

const Selection = createContext<{
  selection: unknown;
  onSelectionChange?: (value: unknown) => void;
} | null>(null);

/** Renders its children in a view. */
export const Host = ({ children }: { children?: ReactNode }) => <View>{children}</View>;

/** Renders the options as a radio group named by `label`. */
export const Picker = ({
  label,
  selection,
  onSelectionChange,
  children,
}: {
  label?: string;
  selection?: unknown;
  onSelectionChange?: (value: unknown) => void;
  children?: ReactNode;
}) => (
  <View accessibilityRole="radiogroup" accessibilityLabel={label}>
    <Selection.Provider value={{ selection, onSelectionChange }}>{children}</Selection.Provider>
  </View>
);

/**
 * Renders text; inside a picker, an option that is selected when its tag
 * is the picker's selection, and chooses it when pressed.
 */
export const Text = ({
  children,
  modifiers = [],
}: {
  children?: ReactNode;
  modifiers?: { tag?: unknown }[];
}) => {
  const picker = useContext(Selection);
  const tag = modifiers.find((modifier) => 'tag' in modifier)?.tag;
  if (!picker) {
    return <NativeText>{children}</NativeText>;
  }
  return (
    <NativeText
      accessibilityRole="radio"
      accessibilityState={{ selected: tag === picker.selection }}
      onPress={() => picker.onSelectionChange?.(tag)}
    >
      {children}
    </NativeText>
  );
};
