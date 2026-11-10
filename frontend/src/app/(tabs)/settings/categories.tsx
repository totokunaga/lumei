import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { ReorderableList } from '@/components/reorderable-list';
import { useDataVersion } from '@/db/changes';
import { database } from '@/db/client';
import { type ManagedCategory, readManagedCategories, reorderCategories } from '@/db/records';
import { TAB_BAR_CLEARANCE } from '@/lib/layout';

/** Renders a category's emoji and name, as a row shows them. */
function CategoryLabel({ category, dim = false }: { category: ManagedCategory; dim?: boolean }) {
  return (
    <>
      <Text className={`text-xl ${dim ? 'opacity-50' : ''}`}>{category.emoji}</Text>
      <Text
        numberOfLines={1}
        className={`flex-1 text-base font-medium ${
          dim ? 'text-gray-500 dark:text-gray-400' : 'text-black dark:text-white'
        }`}
      >
        {category.name}
      </Text>
    </>
  );
}

/**
 * Renders the Categories screen of Settings: the active categories in the
 * order shown when recording an expense, which the user changes by dragging
 * (BR-CAT-02), a button to add one, and the archived categories, by name
 * (BR-CAT-03). Tapping a category opens its sheet to rename it, change its
 * emoji, or archive or unarchive it. It updates after every write, including
 * another device's change pulled by sync.
 */
export default function CategoriesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const version = useDataVersion();
  // Read again after every write, including the sync engine's.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { active, archived } = useMemo(() => readManagedCategories(database()), [version]);

  /** Opens a category's sheet. */
  const open = (category: ManagedCategory) => router.push(`/category/${category.id}`);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="gap-8 px-6 pt-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
    >
      <View className="gap-2">
        <ReorderableList
          items={active}
          itemLabel={(category) => `${category.emoji} ${category.name}`}
          renderItem={(category) => <CategoryLabel category={category} />}
          onPressItem={open}
          onReorder={(ids) => reorderCategories(database(), ids, Date.now())}
        />
        <PressableScale
          accessibilityRole="button"
          onPress={() => router.push('/category/new')}
          className="min-h-14 flex-row items-center gap-3 rounded-2xl px-4"
        >
          <SymbolView
            name={{ ios: 'plus.circle.fill', android: 'add_circle' }}
            size={22}
            tintColor="#10B981"
          />
          <Text className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
            {t('categories.add')}
          </Text>
        </PressableScale>
        <Text className="px-1 text-sm text-gray-500 dark:text-gray-400">
          {t('categories.orderHint')}
        </Text>
      </View>

      {archived.length > 0 && (
        <Animated.View
          entering={FadeIn.duration(200).reduceMotion(ReduceMotion.System)}
          className="gap-2"
        >
          <Text
            accessibilityRole="header"
            className="px-1 text-sm font-medium uppercase text-gray-500 dark:text-gray-400"
          >
            {t('categories.archived')}
          </Text>
          {archived.map((category) => (
            <PressableScale
              key={category.id}
              accessibilityRole="button"
              accessibilityLabel={t('categories.archivedLabel', {
                name: `${category.emoji} ${category.name}`,
              })}
              onPress={() => open(category)}
              className="min-h-14 flex-row items-center gap-3 rounded-2xl bg-gray-100 px-4 dark:bg-gray-900"
            >
              <CategoryLabel category={category} dim />
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right' }}
                size={14}
                tintColor="#9CA3AF"
              />
            </PressableScale>
          ))}
          <Text className="px-1 text-sm text-gray-500 dark:text-gray-400">
            {t('categories.archivedHint')}
          </Text>
        </Animated.View>
      )}
    </ScrollView>
  );
}
