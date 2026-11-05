/** Props of `DateTimeField`. */
export interface DateTimeFieldProps {
  /** What the field sets, for screen readers, e.g. "Date and time". */
  label: string;
  /** The chosen moment, in milliseconds since the epoch. */
  value: number;
  /** Receives the moment the user picked, which may need clamping to `min` and `max`. */
  onChange: (value: number) => void;
  /** The earliest moment offered. */
  min: Date;
  /** The latest moment offered, e.g. now. */
  max: Date;
}
