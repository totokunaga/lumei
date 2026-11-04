import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { PressableScale } from './pressable-scale';

/** Props of `OptionRow`. */
interface OptionRowProps {
  label: string;
  /** A second line, e.g. a currency code. */
  detail?: string;
  /** Shown at the start of the row, e.g. emojis. */
  leading?: ReactNode;
  selected: boolean;
  onPress: () => void;
}

/**
 * Renders one choice of a single-choice list, as a radio button: a rounded
 * card that scales on press, highlighted with a check mark when selected.
 */
export function OptionRow({ label, detail, leading, selected, onPress }: OptionRowProps) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-16 flex-row items-center gap-3 rounded-2xl border-2 px-4 py-3 ${
        selected
          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950'
          : 'border-transparent bg-gray-100 dark:bg-gray-900'
      }`}
    >
      {leading}
      <View className="flex-1">
        <Text className="text-lg font-semibold text-black dark:text-white">{label}</Text>
        {detail && <Text className="text-sm text-gray-500 dark:text-gray-400">{detail}</Text>}
      </View>
      {selected && (
        <SymbolView
          name={{ ios: 'checkmark.circle.fill', android: 'check_circle' }}
          size={24}
          tintColor="#10B981"
        />
      )}
    </PressableScale>
  );
}
