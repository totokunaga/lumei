// Stands in for @expo/ui/jetpack-compose/modifiers: `semantics` keeps what
// TalkBack would read, which the button stand-in in
// expo-ui-jetpack-compose.tsx uses as its accessibility label.

/** Keeps the description TalkBack reads for the view. */
export const semantics = (params: { contentDescription?: string }) => ({ semantics: params });
