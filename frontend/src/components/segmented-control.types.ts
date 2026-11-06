import type { MenuOption } from './menu-picker.types';

/** Props of `SegmentedControl`. */
export interface SegmentedControlProps<T extends string> {
  /** What the control switches, for screen readers, e.g. "Show". */
  label: string;
  /** The segments, in order. */
  options: MenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
}
