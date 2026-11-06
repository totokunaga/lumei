import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';

import { PressableScale } from './pressable-scale';

/** Props of `SettingsRow`. */
interface SettingsRowProps {
  label: string;
  /** The current value, shown before the chevron, e.g. "Day 25". */
  value: string;
  onPress: () => void;
}

/**
 * Renders a settings row that opens another screen: its label, the current
 * value, and a chevron. Screen readers read it as one button with both.
 */
export function SettingsRow({ label, value, onPress }: SettingsRowProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      className="min-h-14 flex-row items-center justify-between gap-3 rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-900"
    >
      <Text className="text-base font-medium text-gray-500 dark:text-gray-400">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-base font-semibold text-black dark:text-white">{value}</Text>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right' }}
          size={14}
          tintColor="#9CA3AF"
        />
      </View>
    </PressableScale>
  );
}
