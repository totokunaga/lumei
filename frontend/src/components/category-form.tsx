import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { database } from '@/db/client';
import { newId } from '@/db/ids';
import {
  addCategory,
  type ManagedCategory,
  readManagedCategories,
  setCategoryArchived,
  updateCategory,
} from '@/db/records';
import { CATEGORY_NAME_MAX, canArchive, isCategoryNameTaken, pickEmoji } from '@/domain/category';
import { ErrorText } from './error-text';

import { EASE_OUT } from './motion';
import { PressableScale } from './pressable-scale';
import { TextField } from './text-field';
import { offerUndo } from './undo-banner';

/** The form as typed. */
interface Values {
  name: string;
  emoji: string;
}

const pop = { duration: 120, easing: EASE_OUT, reduceMotion: ReduceMotion.System };
const settle = { duration: 200, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** Props of `CategoryForm`. */
interface CategoryFormProps {
  /** The category to edit; omitted to add one. */
  category?: ManagedCategory;
}

/**
 * Renders the sheet that adds a category or edits one (BR-CAT-02): an emoji,
 * typed from the keyboard, which grows briefly as it changes, and a name. A
 * name another category already has, archived ones included, ignoring case,
 * can't be saved (BR-CAT-04). Editing also archives the category, closing
 * the sheet with a few seconds to undo, unless it is the last active one,
 * or unarchives it (BR-CAT-03). Saving writes to the device first, with a
 * success haptic.
 */
export function CategoryForm({ category }: CategoryFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [failed, setFailed] = useState(false);
  // Read once: the sheet checks names against the categories as they were when it opened.
  const existing = useMemo(() => readManagedCategories(database()), []);
  const all = [...existing.active, ...existing.archived];
  const archived = category?.archivedAt != null;

  const { control, handleSubmit } = useForm<Values>({
    defaultValues: { name: category?.name ?? '', emoji: category?.emoji ?? '' },
  });
  const [name, emoji] = useWatch({ control, name: ['name', 'emoji'] });
  const taken = name.trim() !== '' && isCategoryNameTaken(name, all, category?.id);
  const valid = name.trim() !== '' && emoji !== '' && !taken;

  // The emoji grows a little and settles back when it changes.
  const scale = useSharedValue(1);
  const emojiStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  /** Saves the category, with a success haptic, and closes the sheet. */
  const save = (values: Values) => {
    const db = database();
    try {
      if (category) {
        updateCategory(db, category.id, values, Date.now());
      } else {
        addCategory(db, values, newId(), Date.now());
      }
    } catch {
      setFailed(true);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  /** Archives or unarchives the category and closes the sheet; archiving offers to undo. */
  const toggleArchived = () => {
    if (!category) {
      return;
    }
    try {
      setCategoryArchived(database(), category.id, !archived, Date.now());
    } catch {
      setFailed(true);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!archived) {
      offerUndo({
        message: t('categories.archivedMessage', { name: category.name }),
        undo: () => setCategoryArchived(database(), category.id, false, Date.now()),
      });
    }
    router.back();
  };

  const lastActive = !archived && !canArchive(existing.active.length);

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-white dark:bg-black">
      <View className="flex-row items-center justify-between px-6 pb-2 pt-6">
        <Text accessibilityRole="header" className="text-3xl font-bold text-black dark:text-white">
          {category ? t('categories.editTitle') : t('categories.newTitle')}
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('expense.close')}
          onPress={() => router.back()}
          className="h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900"
        >
          <SymbolView name={{ ios: 'xmark', android: 'close' }} size={16} tintColor="#6B7280" />
        </PressableScale>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-6 px-6 pb-6 pt-2"
      >
        <View className="items-center gap-2">
          <Animated.View
            style={emojiStyle}
            className="h-24 w-24 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900"
          >
            <Controller
              control={control}
              name="emoji"
              render={({ field }) => (
                <TextField
                  accessibilityLabel={t('categories.emoji')}
                  accessibilityHint={t('categories.emojiHint')}
                  value={field.value}
                  // Typing another emoji replaces it; other characters are ignored.
                  onChangeText={(text) => {
                    const next = text === '' ? '' : (pickEmoji(text) ?? field.value);
                    if (next !== '' && next !== field.value) {
                      scale.set(withSequence(withTiming(1.2, pop), withTiming(1, settle)));
                    }
                    field.onChange(next);
                  }}
                  placeholder="🙂"
                  placeholderTextColor="#9CA3AF"
                  fontSize={44}
                  textAlign="center"
                  autoCorrect={false}
                  autoFocus={!category}
                  caretHidden
                  style={{ width: 96, height: 96 }}
                />
              )}
            />
          </Animated.View>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {t('categories.emojiHint')}
          </Text>
        </View>

        <View className="gap-2">
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <TextField
                accessibilityLabel={t('categories.name')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder={t('categories.namePlaceholder')}
                placeholderTextColor="#9CA3AF"
                maxLength={CATEGORY_NAME_MAX}
                returnKeyType="done"
                fontSize={18}
                className="min-h-14 rounded-2xl bg-gray-100 px-4 text-black dark:bg-gray-900 dark:text-white"
              />
            )}
          />
          {taken && (
            <ErrorText className="px-1 text-sm text-red-500">
              {t('categories.nameTaken', { name: name.trim() })}
            </ErrorText>
          )}
        </View>
      </ScrollView>

      <View style={{ paddingBottom: insets.bottom + 12 }} className="gap-2 px-6 pt-3">
        {failed && (
          <ErrorText className="text-center text-sm text-red-500">
            {t('categories.failed')}
          </ErrorText>
        )}
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid }}
          disabled={!valid}
          onPress={() => void handleSubmit(save)()}
          className={`min-h-14 items-center justify-center rounded-2xl ${
            valid ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-800'
          }`}
        >
          <Text
            className={`text-lg font-semibold ${
              valid ? 'text-white' : 'text-gray-400 dark:text-gray-600'
            }`}
          >
            {t('expense.save')}
          </Text>
        </PressableScale>
        {category && (
          <>
            <PressableScale
              accessibilityRole="button"
              accessibilityState={{ disabled: lastActive }}
              disabled={lastActive}
              onPress={toggleArchived}
              className="min-h-12 items-center justify-center"
            >
              <Text
                className={`text-base font-semibold ${
                  lastActive
                    ? 'text-gray-400 dark:text-gray-600'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {archived ? t('categories.unarchive') : t('categories.archive')}
              </Text>
            </PressableScale>
            <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
              {lastActive
                ? t('categories.lastActive')
                : archived
                  ? t('categories.unarchiveHint')
                  : t('categories.archiveHint')}
            </Text>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
