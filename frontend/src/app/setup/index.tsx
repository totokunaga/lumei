import { getLocales } from 'expo-localization';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';

import { useListCategorySets } from '@/api/generated';
import { LanguagePicker } from '@/components/language-picker';
import { PressableScale } from '@/components/pressable-scale';
import { RegionMap } from '@/components/region-map';
import { SelectRow } from '@/components/select-row';
import { SetupStep } from '@/components/setup-step';
import { detectRegion } from '@/domain/setup';
import { currentLanguage } from '@/i18n';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';
import { ErrorText } from '@/components/error-text';

/**
 * Renders the first setup step: the app language, then the region, which
 * decides the default categories (BR-SET-06, BR-CAT-01), each chosen from a
 * dropdown. A world map above them zooms to the region's countries, and the
 * categories it starts with are shown below as tags, each with its emoji and
 * its name in the app language. The regions come
 * from the seed data on the API (BR-CAT-07); the one matching the device's
 * region setting is preselected. This step can't be skipped (BR-ACC-06).
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

      <RegionMap
        countries={selected?.countries ?? []}
        label={t('setup.region.map', { region: selected?.name[language] ?? '' })}
      />

      {query.isPending && (
        <View className="items-center gap-3 py-10">
          <ActivityIndicator />
          <Text className="text-base text-gray-500">{t('setup.region.loading')}</Text>
        </View>
      )}

      {!query.isPending && !sets && (
        <View className="items-center gap-4 py-10">
          <ErrorText className="text-center text-base text-gray-500">
            {t('setup.region.loadFailed')}
          </ErrorText>
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

      {sets && region && (
        <View className="gap-3">
          <SelectRow
            label={t('setup.region.label')}
            options={sets.map((set) => ({ value: set.region, label: set.name[language] }))}
            value={region}
            onChange={setPicked}
          />
          {selected && (
            <View className="gap-1 px-1">
              <Text
                accessibilityRole="header"
                className="text-sm font-medium text-gray-500 dark:text-gray-400"
              >
                {t('setup.region.startsWith')}
              </Text>
              <View className="flex-row flex-wrap gap-2 pt-1">
                {selected.categories.map((category) => (
                  <View
                    key={category.key}
                    accessible
                    accessibilityLabel={`${category.emoji} ${category.name[language]}`}
                    className="flex-row items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-900"
                  >
                    <Text className="text-base">{category.emoji}</Text>
                    <Text className="text-sm font-medium text-black dark:text-white">
                      {category.name[language]}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </SetupStep>
  );
}
