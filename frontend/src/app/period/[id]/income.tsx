import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ItemListForm } from '@/components/item-list-form';
import { database } from '@/db/client';
import { saveIncomes } from '@/db/records';
import { usePeriodItems } from '@/db/use-period-items';
import { formatPeriodRange } from '@/domain/period';

/**
 * Renders the sheet that edits a period's income items (BR-INC-01,
 * BR-INC-03, BR-INC-04), current or past (BR-HIS-03). Saving changes only
 * that period, and today's numbers update straight away.
 */
export default function PeriodIncomeScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, currency } = usePeriodItems(id);
  if (!items) {
    return null;
  }

  return (
    <ItemListForm
      title={t('budget.income.title')}
      description={t('budget.forPeriod', {
        range: formatPeriodRange(items.period, t, i18n.language),
      })}
      addLabel={t('setup.income.add')}
      placeholder={t('setup.income.placeholder')}
      withNote={false}
      currency={currency}
      initial={items.incomes.map((item) => ({ ...item, note: null }))}
      continueLabel={t('budget.save')}
      onClose={() => router.back()}
      onSubmit={(edited) => {
        saveIncomes(database(), id, edited, Date.now());
        router.back();
      }}
    />
  );
}
