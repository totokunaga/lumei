import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { changeLanguage, type Language } from '@/i18n';

import { PressableScale } from './pressable-scale';

/** Each language in its own name, so anyone can find theirs. */
const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'fr', name: 'Français' },
];

/**
 * Renders the app languages as a row of pills; pressing one switches the app
 * to it and remembers it on the device (BR-SET-01).
 */
export function LanguagePicker() {
  const { t, i18n } = useTranslation();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('setup.region.language')}
      className="flex-row gap-2"
    >
      {LANGUAGES.map(({ code, name }) => {
        const selected = i18n.language === code;
        return (
          <PressableScale
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => void changeLanguage(code)}
            className={`rounded-full px-4 py-2 ${
              selected ? 'bg-black dark:bg-white' : 'bg-gray-100 dark:bg-gray-900'
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                selected ? 'text-white dark:text-black' : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              {name}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
