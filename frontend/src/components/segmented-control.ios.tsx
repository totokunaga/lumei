import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import type { SegmentedControlProps } from './segmented-control.types';

/** Renders a native SwiftUI segmented control across the available width. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <Host matchContents={{ vertical: true }}>
      <Picker
        modifiers={[pickerStyle('segmented')]}
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
