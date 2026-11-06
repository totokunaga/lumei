import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';

import { GlassSurface } from './glass-surface';
import { PressableScale } from './pressable-scale';

/** The button's diameter, in points: large enough to hit with a thumb. */
const SIZE = 64;

/** The plus icon's size, in points. */
const ICON = 28;

/**
 * Renders the floating button that opens expense entry from the home screen
 * (BR-EXP-09): a round button with a plus icon, in accent-tinted Liquid Glass
 * on iOS 26 and a solid accent circle elsewhere. Screen readers announce it
 * as `label`: "Add expense" unless set, e.g. "Add income".
 */
export function QuickAddButton({ onPress, label }: { onPress: () => void; label?: string }) {
  const { t } = useTranslation();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label ?? t('home.addExpense')}
      onPress={onPress}
    >
      <GlassSurface
        interactive
        tintColor="#10B981"
        fallbackClassName="bg-emerald-500 shadow-lg shadow-emerald-900/30"
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SymbolView
          name={{ ios: 'plus', android: 'add' }}
          size={ICON}
          weight="semibold"
          tintColor="white"
          // A fixed square box, so the symbol is centered in it rather than placed by its baseline.
          style={{ width: ICON, height: ICON }}
        />
      </GlassSurface>
    </PressableScale>
  );
}
