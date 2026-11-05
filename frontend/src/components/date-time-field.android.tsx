import {
  DatePickerDialog,
  Host,
  Row,
  Text,
  TextButton,
  TimePickerDialog,
} from '@expo/ui/jetpack-compose';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DateTimeFieldProps } from './date-time-field.types';

/**
 * Renders the date and the time as two Material 3 text buttons, each opening
 * a native picker dialog. The date dialog offers only days from `min` to
 * `max`.
 */
export function DateTimeField({ value, onChange, min, max }: DateTimeFieldProps) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState<'date' | 'time' | null>(null);
  const current = new Date(value);

  return (
    <Host matchContents>
      <Row>
        <TextButton onClick={() => setOpen('date')}>
          <Text>
            {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(current)}
          </Text>
        </TextButton>
        <TextButton onClick={() => setOpen('time')}>
          <Text>
            {new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(current)}
          </Text>
        </TextButton>
      </Row>
      {open === 'date' && (
        <DatePickerDialog
          initialDate={current.toISOString()}
          selectableDates={{ start: min, end: max }}
          onDateSelected={(date) => {
            setOpen(null);
            // The dialog gives the chosen day at midnight UTC; keep the time of day.
            const next = new Date(current);
            next.setFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
            onChange(next.getTime());
          }}
          onDismissRequest={() => setOpen(null)}
        />
      )}
      {open === 'time' && (
        <TimePickerDialog
          initialDate={current.toISOString()}
          onDateSelected={(date) => {
            setOpen(null);
            const next = new Date(current);
            next.setHours(date.getHours(), date.getMinutes(), 0, 0);
            onChange(next.getTime());
          }}
          onDismissRequest={() => setOpen(null)}
        />
      )}
    </Host>
  );
}
