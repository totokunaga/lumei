import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import type { MenuPickerProps } from './menu-picker.types';

/**
 * Renders a native SwiftUI menu picker: the selected option's label, which
 * opens a system menu of every option when tapped.
 */
export function MenuPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: MenuPickerProps<T>) {
  return (
    <Host matchContents>
      <Picker
        modifiers={[pickerStyle('menu')]}
        label={label}
        selection={value}
        onSelectionChange={(selection) => onChange(selection as T)}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
