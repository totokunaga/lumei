import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';

/** Renders the Settings tab as a native stack with large titles. */
export default function SettingsLayout() {
  const { t } = useTranslation();

  return (
    <Stack screenOptions={{ headerLargeTitle: true, headerTransparent: true }}>
      <Stack.Screen name="index" options={{ title: t('settings.title') }} />
      <Stack.Screen
        name="categories"
        options={{ title: t('categories.title'), headerLargeTitle: false }}
      />
      <Stack.Screen
        name="start-day"
        options={{ title: t('settings.startDay.title'), headerLargeTitle: false }}
      />
      <Stack.Screen
        name="delete-account"
        options={{ title: t('deleteAccount.title'), headerLargeTitle: false }}
      />
    </Stack>
  );
}
