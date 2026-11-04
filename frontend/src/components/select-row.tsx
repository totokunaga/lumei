import { Text, View } from 'react-native';

import { MenuPicker } from './menu-picker';
import type { MenuPickerProps } from './menu-picker.types';

/**
 * Renders a labelled row with a native dropdown on its trailing side, e.g.
 * "Language   English ⌄": a system menu on iOS and a Material dropdown on
 * Android.
 */
export function SelectRow<T extends string>(props: MenuPickerProps<T>) {
  return (
    <View className="min-h-14 flex-row items-center justify-between gap-3 rounded-2xl bg-gray-100 py-1 pl-4 pr-2 dark:bg-gray-900">
      <Text className="text-base font-medium text-gray-500 dark:text-gray-400">{props.label}</Text>
      <MenuPicker {...props} />
    </View>
  );
}
