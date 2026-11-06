import {
  Host,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
} from '@expo/ui/jetpack-compose';

import type { SegmentedControlProps } from './segmented-control.types';

/** Renders native Material 3 segmented buttons across the available width. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <Host matchContents={{ vertical: true }}>
      <SingleChoiceSegmentedButtonRow>
        {options.map((option) => (
          <SegmentedButton
            key={option.value}
            selected={option.value === value}
            onClick={() => onChange(option.value)}
          >
            <SegmentedButton.Label>
              <Text>{option.label}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
