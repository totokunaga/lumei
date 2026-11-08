import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';

import type { AllowanceUse } from '@/domain/expense';

import { GlassSurface } from './glass-surface';
import { PressableScale } from './pressable-scale';

/** The button's diameter, in points: large enough to hit with a thumb. */
/** The button's width and height, in points. */
export const QUICK_ADD_SIZE = 64;
const SIZE = QUICK_ADD_SIZE;

/** The plus icon's size, in points. */
const ICON = 28;

/** The button's color for each band of today's allowance used, as today's card (BR-DSH-01). */
const TINT = {
  low: { color: '#10B981', fallback: 'bg-emerald-500 shadow-lg shadow-emerald-900/30' },
  high: { color: '#F59E0B', fallback: 'bg-amber-500 shadow-lg shadow-amber-900/30' },
  critical: { color: '#EF4444', fallback: 'bg-red-500 shadow-lg shadow-red-900/30' },
} as const;

/** Props of `QuickAddButton`. */
interface QuickAddButtonProps {
  onPress: () => void;
  /** What screen readers announce; "Add expense" when omitted, e.g. "Add income". */
  label?: string;
  /** Matches the button to today's card: green, amber, or red; green when omitted. */
  use?: AllowanceUse;
}

/**
 * Renders the floating button that opens expense entry from the home screen
 * (BR-EXP-09): a round button with a plus icon, in tinted Liquid Glass on
 * iOS 26 and a solid circle elsewhere, green, amber, or red as today's card. Screen readers announce it
 * as `label`: "Add expense" unless set, e.g. "Add income".
 */
export function QuickAddButton({ onPress, label, use = 'low' }: QuickAddButtonProps) {
  const { t } = useTranslation();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label ?? t('home.addExpense')}
      onPress={onPress}
    >
      <GlassSurface
        interactive
        tintColor={TINT[use].color}
        fallbackClassName={TINT[use].fallback}
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
