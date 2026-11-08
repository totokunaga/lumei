import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { startDayCalendar, weekdayNames, weekStartFor } from '@/domain/calendar';
import type { IsoDate } from '@/domain/date';
import type { StartDay } from '@/domain/period';

import { PressableScale } from './pressable-scale';

/** Props of `DayGrid`. */
interface DayGridProps {
  value: StartDay;
  onChange: (day: StartDay) => void;
  /** Today, whose month the calendar shows. */
  today: IsoDate;
}

/**
 * Renders the period start day picker (BR-PER-01) as a calendar of the
 * current month: the weekdays on top, the 1st under its own, and today marked
 * with a dot. Every day 1–31 can be picked; days after the month's last, e.g.
 * 31 in November, follow it in a lighter color. It reads as one radio group
 * for screen readers, today's day named as such.
 */
export function DayGrid({ value, onChange, today }: DayGridProps) {
  const { t, i18n } = useTranslation();
  const weekStart = weekStartFor(i18n.language);
  const calendar = startDayCalendar(today, weekStart);

  return (
    <View className="gap-1">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="flex-row"
      >
        {weekdayNames(i18n.language, weekStart).map((name, index) => (
          <Text
            key={index}
            className="flex-1 text-center text-xs font-semibold text-gray-400 dark:text-gray-500"
          >
            {name}
          </Text>
        ))}
      </View>
      <View accessibilityRole="radiogroup" className="gap-1">
        {calendar.weeks.map((week, row) => (
          <View key={row} className="flex-row">
            {week.map((d, column) =>
              d === null ? (
                <View key={`blank-${column}`} className="flex-1" />
              ) : (
                <View key={d} className="flex-1 items-center">
                  <Day
                    day={d}
                    selected={d === value}
                    today={d === calendar.today}
                    outsideMonth={d > calendar.monthDays}
                    label={
                      d === calendar.today
                        ? t('setup.startDay.today', { day: d })
                        : t('setup.startDay.day', { day: d })
                    }
                    onPress={() => onChange(d)}
                  />
                </View>
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

/** Renders one day of the calendar as a round button, with a dot under today's number. */
function Day({
  day,
  selected,
  today,
  outsideMonth,
  label,
  onPress,
}: {
  day: StartDay;
  selected: boolean;
  today: boolean;
  outsideMonth: boolean;
  label: string;
  onPress: () => void;
}) {
  const text = selected
    ? 'text-white'
    : outsideMonth
      ? 'text-gray-400 dark:text-gray-600'
      : today
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-black dark:text-white';
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-full ${
        selected ? 'bg-emerald-500' : today ? 'bg-emerald-50 dark:bg-emerald-950' : ''
      }`}
    >
      <Text className={`text-base font-semibold ${text}`}>{day}</Text>
      {today && (
        <View
          className={`absolute bottom-1.5 h-1 w-1 rounded-full ${
            selected ? 'bg-white' : 'bg-emerald-500'
          }`}
        />
      )}
    </PressableScale>
  );
}
