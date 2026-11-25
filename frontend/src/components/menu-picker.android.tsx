import { DropdownMenu, DropdownMenuItem, Host, Text, TextButton } from '@expo/ui/jetpack-compose';
import { semantics } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';

import type { MenuPickerProps } from './menu-picker.types';

/**
 * Renders a native Material 3 dropdown menu: a text button with the selected
 * option's label, which opens a menu of every option when tapped. TalkBack
 * reads what is being chosen and the choice, without the ▾ (BR-NFR-07).
 */
export function MenuPicker<T extends string>({
  label,
  options,
  value,
  onChange,
}: MenuPickerProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Host matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <DropdownMenu.Trigger>
          <TextButton
            onClick={() => setExpanded(true)}
            modifiers={[semantics({ contentDescription: `${label}, ${selected?.label ?? ''}` })]}
          >
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
