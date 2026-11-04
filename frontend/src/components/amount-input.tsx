import { StyleSheet, Text, type TextInputProps, View } from 'react-native';

import {
  CURRENCIES,
  type CurrencyCode,
  currencySymbol,
  formatAmountText,
  readAmountText,
} from '@/domain/money';

import { TextField } from './text-field';

/** Props of `AmountInput`: a `TextInput`'s, plus the currency and language. */
interface AmountInputProps extends Omit<TextInputProps, 'keyboardType'> {
  currency: CurrencyCode;
  /** The app language, which decides the symbol, e.g. "￥" in Japanese, and the grouping. */
  locale: string;
  /**
   * The amount as typed, without grouping and with `.` as the decimal
   * separator, e.g. `"1234.5"`: what `parseAmount` reads. `onChangeText`
   * receives it in the same form.
   */
  value: string;
  /** Shows the field in the error color. */
  invalid?: boolean;
}

/**
 * Renders a text field for an amount in the account currency, with the
 * currency symbol in front and a number pad with a decimal key only when the
 * currency has decimals (none for JPY, BR-EXP-08). The amount and the
 * placeholder are shown grouped the way the app language writes numbers,
 * e.g. "1,234.5" in English and "1 234,5" in French.
 */
export function AmountInput({
  currency,
  locale,
  value,
  onChangeText,
  placeholder,
  invalid = false,
  className,
  ...props
}: AmountInputProps) {
  return (
    <View
      className={`h-14 flex-row items-center gap-2 rounded-2xl border-2 bg-gray-100 px-4 dark:bg-gray-900 ${
        invalid ? 'border-red-500' : 'border-transparent'
      } ${className ?? ''}`}
    >
      <Text style={styles.text} className="text-gray-400">
        {currencySymbol(currency, locale)}
      </Text>
      <TextField
        {...props}
        fontSize={20}
        value={formatAmountText(value, locale)}
        onChangeText={(text) => onChangeText?.(readAmountText(text, currency, locale))}
        placeholder={placeholder && formatAmountText(placeholder, locale)}
        keyboardType={CURRENCIES[currency] === 0 ? 'number-pad' : 'decimal-pad'}
        placeholderTextColor="#9CA3AF"
        style={styles.input}
        className="flex-1 text-black dark:text-white"
      />
    </View>
  );
}

// The symbol and the amount share one font size and no line height, so they
// line up (see TextField).
const styles = StyleSheet.create({
  text: { fontSize: 20, fontWeight: '600' },
  input: { height: '100%', fontWeight: '600' },
});
