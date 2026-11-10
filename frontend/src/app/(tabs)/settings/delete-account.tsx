import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteAccount, type DeleteAccountResult } from '@/auth/delete-account';
import { PressableScale } from '@/components/pressable-scale';
import { TextField } from '@/components/text-field';
import { database } from '@/db/client';
import { countPendingChanges } from '@/db/records';
import { TAB_BAR_CLEARANCE } from '@/lib/layout';
import { ErrorText } from '@/components/error-text';

/** The reasons a deletion didn't happen, which the screen explains. */
type DeleteError = Exclude<DeleteAccountResult, 'deleted'>;

/**
 * Renders the screen that deletes the account (BR-ACC-05). It lists what is
 * deleted, on every device and for good, and says when this device has
 * unsynced changes, which go too. The button works only once the user types
 * the confirmation word, so a stray tap can't delete everything. Deleting
 * needs a connection; if it fails, nothing is deleted and the screen says
 * why. Once deleted, the app signs out and opens the sign-in screen.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const unsynced = useMemo(() => countPendingChanges(database()), []);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<DeleteError | null>(null);

  const word = t('deleteAccount.word');
  const confirmed = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  /** Deletes the account, or shows why it couldn't. */
  const remove = async () => {
    if (!confirmed || deleting) {
      return;
    }
    setDeleting(true);
    setError(null);
    const result = await deleteAccount();
    if (result !== 'deleted') {
      setError(result);
      setDeleting(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName="gap-6 px-6 pt-4"
      contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
    >
      <View className="gap-3">
        <Text className="text-base text-black dark:text-white">{t('deleteAccount.intro')}</Text>
        <View className="gap-2 rounded-2xl bg-gray-100 px-4 py-3 dark:bg-gray-900">
          {(['expenses', 'budget', 'categories'] as const).map((item) => (
            <Text key={item} className="text-base text-black dark:text-white">
              {`• ${t(`deleteAccount.items.${item}`)}`}
            </Text>
          ))}
        </View>
        <Text className="text-base text-gray-600 dark:text-gray-300">
          {t('deleteAccount.signIns')}
        </Text>
        {unsynced > 0 && (
          <Text className="text-base text-amber-700 dark:text-amber-400">
            {t('deleteAccount.unsynced', { count: unsynced })}
          </Text>
        )}
        <Text className="text-sm text-gray-500 dark:text-gray-400">
          {t('deleteAccount.online')}
        </Text>
      </View>

      <View className="gap-2">
        <Text className="px-1 text-sm font-medium text-gray-500 dark:text-gray-400">
          {t('deleteAccount.typeToConfirm', { word })}
        </Text>
        <TextField
          accessibilityLabel={t('deleteAccount.typeToConfirm', { word })}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!deleting}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={() => void remove()}
          returnKeyType="done"
          fontSize={18}
          className="min-h-14 rounded-2xl bg-gray-100 px-4 text-black dark:bg-gray-900 dark:text-white"
        />
      </View>

      {error && (
        <ErrorText className="text-base text-red-600 dark:text-red-400">
          {t(`deleteAccount.errors.${error}`)}
        </ErrorText>
      )}

      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ busy: deleting, disabled: !confirmed || deleting }}
        disabled={!confirmed || deleting}
        onPress={() => void remove()}
        className={`min-h-14 flex-row items-center justify-center gap-2 rounded-2xl ${
          confirmed ? 'bg-red-600 dark:bg-red-500' : 'bg-gray-100 dark:bg-gray-900'
        }`}
      >
        {deleting && <ActivityIndicator color="white" />}
        <Text
          className={`text-lg font-semibold ${
            confirmed ? 'text-white' : 'text-gray-400 dark:text-gray-600'
          }`}
        >
          {t('deleteAccount.confirm')}
        </Text>
      </PressableScale>
    </ScrollView>
  );
}
