import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { SetupStep } from '@/components/setup-step';
import { localToday } from '@/domain/date';
import { formatPeriodLabel, periodContaining, type StartDay } from '@/domain/period';
import { DEFAULT_START_DAY } from '@/domain/setup';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';

const DAYS: StartDay[] = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Renders the period start day step (BR-PER-01): a grid of the days 1–31 and
 * the current period the chosen day gives, labelled as the app labels periods
 * (BR-PER-06). For days 29–31 it says how shorter months are handled
 * (BR-PER-02). Skipping keeps day 1, calendar months.
 */
export default function StartDayStep() {
  const { t, i18n } = useTranslation();
  const flow = useSetupFlow();
  const day = useSetupDraft((s) => s.periodStartDay);
  const setPeriodStartDay = useSetupDraft((s) => s.setPeriodStartDay);
  const period = periodContaining(localToday(), day);

  return (
    <SetupStep
      step="start-day"
      title={t('setup.startDay.title')}
      description={t('setup.startDay.description')}
      editing={flow.editing}
      onContinue={() => flow.next('/setup/income')}
      onSkip={() => {
        setPeriodStartDay(DEFAULT_START_DAY);
        flow.next('/setup/income');
      }}
    >
      <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
        {DAYS.map((d) => {
          const selected = d === day;
          return (
            <PressableScale
              key={d}
              accessibilityRole="radio"
              accessibilityLabel={t('setup.startDay.day', { day: d })}
              accessibilityState={{ selected }}
              onPress={() => setPeriodStartDay(d)}
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

      <View className="gap-1 rounded-3xl bg-gray-50 p-5 dark:bg-gray-950">
        <Text className="text-sm font-medium uppercase text-gray-500">
          {t('setup.startDay.current')}
        </Text>
        <Text className="text-xl font-bold text-black dark:text-white">
          {formatPeriodLabel(period, t, i18n.language)}
        </Text>
        {day > 28 && (
          <Text className="pt-1 text-sm text-gray-500 dark:text-gray-400">
            {t('setup.startDay.shortMonths', { day })}
          </Text>
        )}
      </View>
    </SetupStep>
  );
}
