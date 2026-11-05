// Stands in for @expo/ui/swift-ui/modifiers: `tag` keeps its value for the
// picker stand-in in expo-ui-swift-ui.tsx, and styles do nothing.

/** Tags a picker option with its value. */
export const tag = (value: unknown) => ({ tag: value });

/** Does nothing: the stand-in picker has one look. */
export const pickerStyle = () => ({});

/** Does nothing: the stand-in date picker has no label to hide. */
export const labelsHidden = () => ({});
