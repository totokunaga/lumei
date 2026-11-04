import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { useGetHealth } from '@/api/generated';
import { useAuth } from '@/auth/store';
import { PressableScale } from '@/components/pressable-scale';

/**
 * Renders the home screen: the app title, whether the API is reachable, and
 * the signed-in account with a sign-out button (BR-ACC-04).
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const health = useGetHealth();
  const email = useAuth((s) => s.session?.user.email);
  const signOut = useAuth((s) => s.signOut);

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
      {email && <Text className="text-base text-gray-500">{t('home.signedInAs', { email })}</Text>}
      <PressableScale
        accessibilityRole="button"
        onPress={() => void signOut()}
        className="mt-4 rounded-full bg-gray-100 px-5 py-3 dark:bg-gray-900"
      >
        <Text className="text-base font-semibold text-black dark:text-white">
          {t('home.signOut')}
        </Text>
      </PressableScale>
    </View>
  );
}
