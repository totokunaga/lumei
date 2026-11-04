import { useTranslation } from 'react-i18next';

import { ItemListForm } from '@/components/item-list-form';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';

/**
 * Renders the income step (BR-INC-01): the income items of the first period,
 * each a name and an amount. Skipping leaves the period without income, to be
 * added later.
 */
export default function IncomeStep() {
  const { t } = useTranslation();
  const flow = useSetupFlow();
  const currency = useSetupDraft((s) => s.currency) ?? 'USD';
  const incomes = useSetupDraft((s) => s.incomes);
  const setIncomes = useSetupDraft((s) => s.setIncomes);

  return (
    <ItemListForm
      title={t('setup.income.title')}
      description={t('setup.income.description')}
      addLabel={t('setup.income.add')}
      placeholder={t('setup.income.placeholder')}
      withNote={false}
      editing={flow.editing}
      currency={currency}
      initial={incomes.map((item) => ({ ...item, note: null }))}
      onSubmit={(items) => {
        setIncomes(items.map(({ name, amount }) => ({ name, amount })));
        flow.next('/setup/fixed-expenses');
      }}
      onSkip={() => {
        setIncomes([]);
        flow.next('/setup/fixed-expenses');
      }}
    />
  );
}
