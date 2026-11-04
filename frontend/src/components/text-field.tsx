import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

/** Props of `TextField`: a `TextInput`'s, plus the font size. */
interface TextFieldProps extends TextInputProps {
  /** The text's size in points: 16 like Tailwind's text-base, 18 like text-lg. */
  fontSize?: 16 | 18 | 20;
}

/**
 * Renders a text field with its text centred vertically. Set the font size
 * here rather than with a Tailwind text-* class: those also set a line
 * height, and on iOS a text field with one draws its text below the middle.
 */
export function TextField({ fontSize = 16, style, ...props }: TextFieldProps) {
  return <TextInput {...props} style={[styles.field, { fontSize }, style]} />;
}

const styles = StyleSheet.create({
  field: { paddingVertical: 0, textAlignVertical: 'center' },
});
