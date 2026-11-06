import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ItemListForm } from '@/components/item-list-form';
import { database } from '@/db/client';
import { saveFixedExpenses } from '@/db/records';
import { usePeriodItems } from '@/db/use-period-items';
import { formatPeriodRange } from '@/domain/period';

/**
 * Renders the sheet that edits a period's fixed expense items (BR-INC-02 to
 * BR-INC-04), current or past (BR-HIS-03). Saving changes only that period,
 * and today's numbers update straight away.
 */
export default function PeriodFixedExpensesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, currency } = usePeriodItems(id);
  if (!items) {
    return null;
  }

  return (
    <ItemListForm
      title={t('budget.fixedExpenses.title')}
      description={t('budget.forPeriod', {
        range: formatPeriodRange(items.period, t, i18n.language),
      })}
      addLabel={t('setup.fixedExpenses.add')}
      placeholder={t('setup.fixedExpenses.placeholder')}
      withNote
      currency={currency}
      initial={items.fixedExpenses}
      continueLabel={t('budget.save')}
      onClose={() => router.back()}
      onSubmit={(edited) => {
        saveFixedExpenses(database(), id, edited, Date.now());
        router.back();
      }}
    />
  );
}
