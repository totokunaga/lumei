import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';

import { useListCategorySets } from '@/api/generated';
import { LanguagePicker } from '@/components/language-picker';
import { OptionRow } from '@/components/option-row';
import { PressableScale } from '@/components/pressable-scale';
import { SetupStep } from '@/components/setup-step';
import { detectRegion } from '@/domain/setup';
import { currentLanguage } from '@/i18n';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';

/**
 * Renders the first setup step: the app language, then the region, which
 * decides the default categories (BR-SET-06, BR-CAT-01). The regions come
 * from the seed data on the API (BR-CAT-07); the one matching the device's
 * region setting is preselected, and each shows the emojis of the categories
 * it starts with. This step can't be skipped (BR-ACC-06).
 */
export default function RegionStep() {
  const { t } = useTranslation();
  const flow = useSetupFlow();
  const chosen = useSetupDraft((s) => s.set);
  const chooseSet = useSetupDraft((s) => s.chooseSet);
  const query = useListCategorySets();
  const sets = query.data?.status === 200 ? query.data.data.sets : null;
  const [picked, setPicked] = useState<string | null>(chosen?.region ?? null);

  const region = picked ?? (sets ? detectRegion(sets, getLocales()[0]?.regionCode) : null);
  const selected = sets?.find((set) => set.region === region) ?? null;
  const language = currentLanguage();

  return (
    <SetupStep
      step="index"
      title={t('setup.region.title')}
      description={t('setup.region.description')}
      editing={flow.editing}
      continueDisabled={!selected}
      onContinue={() => {
        if (selected) {
          chooseSet(selected);
          flow.next('/setup/currency');
        }
      }}
    >
      <LanguagePicker />

      {query.isPending && (
        <View className="items-center gap-3 py-10">
          <ActivityIndicator />
          <Text className="text-base text-gray-500">{t('setup.region.loading')}</Text>
        </View>
      )}

      {!query.isPending && !sets && (
        <View className="items-center gap-4 py-10">
          <Text accessibilityRole="alert" className="text-center text-base text-gray-500">
            {t('setup.region.loadFailed')}
          </Text>
          <PressableScale
            accessibilityRole="button"
            onPress={() => void query.refetch()}
            className="rounded-full bg-gray-100 px-5 py-3 dark:bg-gray-900"
          >
            <Text className="text-base font-semibold text-black dark:text-white">
              {t('setup.region.retry')}
            </Text>
          </PressableScale>
        </View>
      )}

      {sets && (
        <View accessibilityRole="radiogroup" className="gap-3">
          {sets.map((set) => (
            <OptionRow
              key={set.region}
              label={set.name[language]}
              detail={set.categories.map((category) => category.emoji).join(' ')}
              selected={set.region === region}
              onPress={() => setPicked(set.region)}
            />
          ))}
        </View>
      )}
    </SetupStep>
  );
}
