import { DatePicker, Host } from '@expo/ui/swift-ui';
import { labelsHidden } from '@expo/ui/swift-ui/modifiers';

import type { DateTimeFieldProps } from './date-time-field.types';

/**
 * Renders a native SwiftUI date and time picker in its compact style: the
 * date and the time as two buttons, each opening a system picker limited to
 * `min` and `max`.
 */
export function DateTimeField({ label, value, onChange, min, max }: DateTimeFieldProps) {
  return (
    <Host matchContents>
      <DatePicker
        title={label}
        modifiers={[labelsHidden()]}
        selection={new Date(value)}
        range={{ start: min, end: max }}
        displayedComponents={['date', 'hourAndMinute']}
        onDateChange={(date) => onChange(date.getTime())}
      />
    </Host>
  );
}
