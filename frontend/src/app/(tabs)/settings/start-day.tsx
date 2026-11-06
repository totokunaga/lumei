import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DayGrid } from '@/components/day-grid';
import { OptionRow } from '@/components/option-row';
import { PressableScale } from '@/components/pressable-scale';
import { database } from '@/db/client';
import { changeStartDay, readPeriodOn, readSettings } from '@/db/records';
import { useToday } from '@/db/use-today';
import { addDays } from '@/domain/date';
import {
  formatPeriodRange,
  formatShortDate,
  type Period,
  periodContaining,
  periodDays,
  type StartDay,
} from '@/domain/period';
import { type GapChoice, startDayChange, startDayGap } from '@/domain/start-day';
import { TAB_BAR_CLEARANCE } from '@/lib/layout';

const CHOICES: GapChoice[] = ['current', 'next', 'own'];

/**
 * Renders the screen that changes the period start day (BR-PER-05). Past
 * periods and the current period's start keep their dates. If the new day
 * leaves days between the current period's end and the next new start, the
 * user chooses whether they join this period, join the next one, or become a
 * period of their own, each shown with the dates it gives. Nothing is
 * preselected: the right answer depends on when the user is paid.
 */
export default function StartDayScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { current, saved } = useMemo(() => {
    const db = database();
    return { current: readPeriodOn(db, today), saved: readSettings(db)?.periodStartDay ?? 1 };
  }, [today]);
  const [day, setDay] = useState<StartDay>(saved);
  const [choice, setChoice] = useState<GapChoice | null>(null);

  const gap = current && day !== saved ? startDayGap(current, day) : null;
  const range = (period: Period) =>
    t('settings.startDay.rangeDays', {
      range: formatPeriodRange(period, t, i18n.language),
      count: periodDays(period),
    });
  const canSave = current !== null && day !== saved && (gap === null || choice !== null);

  /** Describes what a choice gives, with its dates. */
  const describe = (option: GapChoice): string => {
    if (!current || !gap) {
      return '';
    }
    const change = startDayChange(current, day, option);
    switch (option) {
      case 'current':
        return t('settings.startDay.currentDetail', {
          range: range({ start: current.start, end: change.currentEnd }),
          date: formatShortDate(addDays(gap.end, 1), i18n.language),
        });
      case 'next':
        return t('settings.startDay.nextDetail', {
          range: range({ start: gap.start, end: change.nextPeriodEnd! }),
          date: formatShortDate(gap.start, i18n.language),
        });
      case 'own':
        return t('settings.startDay.ownDetail', { range: range(gap) });
    }
  };

  /** Saves the new start day and where the gap goes, then goes back. */
  const save = () => {
    if (!canSave) {
      return;
    }
    changeStartDay(database(), day, choice ?? 'own', today, Date.now());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-6 pb-6 pt-4"
      >
        <Text className="text-base text-gray-500 dark:text-gray-400">
          {t('settings.startDay.description')}
        </Text>
        <DayGrid
          value={day}
          onChange={(d) => {
            setDay(d);
            setChoice(null);
          }}
        />

        {current && (
          <View className="gap-1 rounded-3xl bg-gray-50 p-5 dark:bg-gray-950">
            <Text className="text-sm font-medium uppercase text-gray-500">
              {t('settings.startDay.current')}
            </Text>
            <Text className="text-lg font-semibold text-black dark:text-white">
              {range(current)}
            </Text>
            {day !== saved && !gap && (
              <Text className="pt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('settings.startDay.nextAligned', {
                  range: range(periodContaining(addDays(current.end, 1), day)),
                })}
              </Text>
            )}
          </View>
        )}

        {gap && (
          <View className="gap-3">
            <Text
              accessibilityRole="header"
              className="text-lg font-bold text-black dark:text-white"
            >
              {t('settings.startDay.gapQuestion', {
                range: formatPeriodRange(gap, t, i18n.language),
              })}
            </Text>
            <View accessibilityRole="radiogroup" className="gap-2">
              {CHOICES.map((option) => (
                <OptionRow
                  key={option}
                  label={t(`settings.startDay.choice.${option}`)}
                  detail={describe(option)}
                  selected={choice === option}
                  onPress={() => setChoice(option)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 12 }} className="px-6 pt-3">
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={save}
          className={`h-14 items-center justify-center rounded-2xl ${
            canSave ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-800'
          }`}
        >
          <Text
            className={`text-lg font-semibold ${
              canSave ? 'text-white' : 'text-gray-400 dark:text-gray-600'
            }`}
          >
            {t('settings.startDay.save')}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}
