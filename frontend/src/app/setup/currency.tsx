import { getLocales } from 'expo-localization';
import { type ComponentRef, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { OptionRow } from '@/components/option-row';
import { SetupStep } from '@/components/setup-step';
import { CURRENCIES, type CurrencyCode, currencySymbol } from '@/domain/money';
import { suggestCurrency } from '@/domain/setup';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';

/** Every supported currency, by code (see Currencies in the business requirements). */
const CODES = Object.keys(CURRENCIES) as CurrencyCode[];

/**
 * Renders the currency step (BR-SET-03): every supported currency, with the
 * device region's preselected, or USD when it isn't supported. It says the
 * currency can't change after setup (BR-SET-04), and can't be skipped
 * (BR-ACC-06). It opens scrolled to the selected currency, which can be far
 * down the list. A choice is kept as soon as it is made, so going back a step
 * doesn't lose it.
 */
export default function CurrencyStep() {
  const { t, i18n } = useTranslation();
  const flow = useSetupFlow();
  const chosen = useSetupDraft((s) => s.currency);
  const chooseCurrency = useSetupDraft((s) => s.chooseCurrency);
  const currency = chosen ?? suggestCurrency(getLocales()[0]?.currencyCode);
  const selectedRef = useRef<ComponentRef<typeof View>>(null);

  return (
    <SetupStep
      title={t('setup.currency.title')}
      description={t('setup.currency.description')}
      onContinue={() => {
        chooseCurrency(currency);
        flow.next('/setup/start-day');
      }}
      editing={flow.editing}
      revealRef={selectedRef}
      footer={
        <Text className="pb-1 text-center text-sm font-medium text-amber-600 dark:text-amber-400">
          {t('setup.currency.notice')}
        </Text>
      }
    >
      <View accessibilityRole="radiogroup" className="gap-3">
        {CODES.map((code) => (
          <View key={code} ref={code === currency ? selectedRef : undefined}>
            <OptionRow
              label={t(`currencies.${code}`)}
              detail={code}
              leading={
                <Text className="w-10 text-center text-xl font-bold text-gray-400">
                  {currencySymbol(code, i18n.language)}
                </Text>
              }
              selected={code === currency}
              onPress={() => chooseCurrency(code)}
            />
          </View>
        ))}
      </View>
    </SetupStep>
  );
}
