// Stands in for @expo/ui/jetpack-compose, whose views are native: buttons
// and menu items are pressable, and a dropdown menu shows its items only
// while expanded, as on a device.
import { createContext, type ReactNode, useContext } from 'react';
import { Pressable, Text as NativeText, View } from 'react-native';

const Expanded = createContext(false);

/** Renders its children in a view. */
export const Host = ({ children }: { children?: ReactNode }) => <View>{children}</View>;

/** Renders text. */
export const Text = ({ children }: { children?: ReactNode }) => (
  <NativeText>{children}</NativeText>
);

/** Renders a button that calls `onClick` when pressed. */
export const TextButton = ({ onClick, children }: { onClick?: () => void; children?: ReactNode }) => (
  <Pressable accessibilityRole="button" onPress={onClick}>
    {children}
  </Pressable>
);

/** Renders the trigger, and the items while `expanded`. */
export const DropdownMenu = ({
  expanded = false,
  children,
}: {
  expanded?: boolean;
  onDismissRequest?: () => void;
  children?: ReactNode;
}) => <Expanded.Provider value={expanded}>{children}</Expanded.Provider>;

/** Renders the trigger. */
DropdownMenu.Trigger = ({ children }: { children?: ReactNode }) => <>{children}</>;

/** Renders the items while the menu is expanded. */
DropdownMenu.Items = function Items({ children }: { children?: ReactNode }) {
  return useContext(Expanded) ? <View>{children}</View> : null;
};

/** Renders a menu item that calls `onClick` when pressed. */
export const DropdownMenuItem = ({
  onClick,
  children,
}: {
  onClick?: () => void;
  children?: ReactNode;
}) => (
  <Pressable accessibilityRole="menuitem" onPress={onClick}>
    {children}
  </Pressable>
);

/** Renders the item's text. */
DropdownMenuItem.Text = ({ children }: { children?: ReactNode }) => <>{children}</>;
