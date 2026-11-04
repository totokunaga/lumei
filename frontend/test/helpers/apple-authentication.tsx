// A stand-in for expo-apple-authentication, whose button is native. Load it
// with `jest.mock('expo-apple-authentication', () => require(...))`, and set
// `isAvailableAsync` and `signInAsync` per case with jest.mocked.
import { Pressable, Text } from 'react-native';

export const isAvailableAsync = jest.fn();
export const signInAsync = jest.fn();
export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 };
export const AppleAuthenticationButtonType = { SIGN_IN: 0 };
export const AppleAuthenticationButtonStyle = { WHITE: 0, BLACK: 2 };

/** Renders a plain button labelled like Apple's. */
export function AppleAuthenticationButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Text>Sign in with Apple</Text>
    </Pressable>
  );
}
