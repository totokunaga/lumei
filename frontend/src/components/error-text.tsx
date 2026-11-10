import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Text, type TextProps } from 'react-native';

/** Props of `ErrorText`: a `Text`'s, with the message as its only child. */
interface ErrorTextProps extends Omit<TextProps, 'children'> {
  children: string;
}

/**
 * Renders an error message, and has screen readers say it as it appears or
 * changes (BR-NFR-07). Android reads it through its live region; iOS has no
 * live regions, so the message is announced.
 */
export function ErrorText({ children, ...props }: ErrorTextProps) {
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(children);
    }
  }, [children]);

  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" {...props}>
      {children}
    </Text>
  );
}
