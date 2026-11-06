import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { StartDay } from '@/domain/period';

import { PressableScale } from './pressable-scale';

const DAYS: StartDay[] = Array.from({ length: 31 }, (_, i) => i + 1);

/** Props of `DayGrid`. */
interface DayGridProps {
  value: StartDay;
  onChange: (day: StartDay) => void;
}

/**
 * Renders the days 1–31 as a grid of round buttons to pick the period start
 * day from (BR-PER-01), as one radio group for screen readers.
 */
export function DayGrid({ value, onChange }: DayGridProps) {
  const { t } = useTranslation();

  return (
    <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
      {DAYS.map((d) => {
        const selected = d === value;
        return (
          <PressableScale
            key={d}
            accessibilityRole="radio"
            accessibilityLabel={t('setup.startDay.day', { day: d })}
            accessibilityState={{ selected }}
            onPress={() => onChange(d)}
            className={`h-12 w-12 items-center justify-center rounded-full ${
              selected ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-900'
            }`}
          >
            <Text
              className={`text-base font-semibold ${
                selected ? 'text-white' : 'text-black dark:text-white'
              }`}
            >
              {d}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
