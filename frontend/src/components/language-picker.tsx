import { useTranslation } from 'react-i18next';

import { changeLanguage, currentLanguage, type Language } from '@/i18n';

import type { MenuOption } from './menu-picker.types';
import { SelectRow } from './select-row';

/** Each language in its own name, so anyone can find theirs. */
const LANGUAGES: MenuOption<Language>[] = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'fr', label: 'Français' },
];

/**
 * Renders the app language as a dropdown row, starting on the device's
 * language; choosing one switches the app to it and remembers it on the
 * device (BR-SET-01).
 */
export function LanguagePicker() {
  const { t } = useTranslation();

  return (
    <SelectRow
      label={t('setup.region.language')}
      options={LANGUAGES}
      value={currentLanguage()}
      onChange={(language) => void changeLanguage(language)}
    />
  );
}
