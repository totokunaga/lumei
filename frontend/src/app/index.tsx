import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { useGetHealth } from '@/api/generated';

/**
 * Renders the home screen: the app title and whether the API is reachable.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const health = useGetHealth();

  let apiStatus = t('home.apiChecking');
  if (health.isError) {
    apiStatus = t('home.apiUnreachable');
  } else if (health.data) {
    apiStatus = t('home.apiStatus', { status: health.data.data.status });
  }

  return (
    <View className="flex-1 items-center justify-center gap-2 bg-white dark:bg-black">
      <Text className="text-3xl font-bold text-black dark:text-white">{t('home.title')}</Text>
      <Text className="text-base text-gray-500">{apiStatus}</Text>
    </View>
  );
}
