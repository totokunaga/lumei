// Whether the screen showing a component is the one in front, e.g. to pause
// an animation on a tab the user has left.
import { NavigationContext } from 'expo-router/react-navigation';
import { useContext, useEffect, useState } from 'react';

/**
 * Follows whether the enclosing screen is focused. Outside any navigator,
 * e.g. in a component test, it counts as focused.
 * @returns True while the screen is in front.
 */
export const useScreenFocused = (): boolean => {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) {
      return;
    }
    const stopFocus = navigation.addListener('focus', () => setFocused(true));
    const stopBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      stopFocus();
      stopBlur();
    };
  }, [navigation]);
  return focused;
};
