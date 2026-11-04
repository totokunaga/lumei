/** One choice of a `MenuPicker`. */
export interface MenuOption<T extends string> {
  value: T;
  label: string;
}

/** Props of `MenuPicker`. */
export interface MenuPickerProps<T extends string> {
  /** What is being chosen, e.g. "Region", for screen readers. */
  label: string;
  options: readonly MenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
}
