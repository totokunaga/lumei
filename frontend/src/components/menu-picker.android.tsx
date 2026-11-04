import { DropdownMenu, DropdownMenuItem, Host, Text, TextButton } from '@expo/ui/jetpack-compose';
import { useState } from 'react';

import type { MenuPickerProps } from './menu-picker.types';

/**
 * Renders a native Material 3 dropdown menu: a text button with the selected
 * option's label, which opens a menu of every option when tapped.
 */
export function MenuPicker<T extends string>({ options, value, onChange }: MenuPickerProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <DropdownMenu.Trigger>
          <TextButton onClick={() => setExpanded(true)}>
            <Text>{`${selected?.label ?? ''} ▾`}</Text>
          </TextButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => {
                setExpanded(false);
                onChange(option.value);
              }}
            >
              <DropdownMenuItem.Text>
                <Text>{option.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </Host>
  );
}
