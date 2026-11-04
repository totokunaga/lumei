import { useTranslation } from 'react-i18next';

import { ItemListForm } from '@/components/item-list-form';
import { useSetupDraft } from '@/setup/draft';
import { useSetupFlow } from '@/setup/navigation';

/**
 * Renders the fixed expenses step (BR-INC-02): the fixed expense items of the
 * first period, each a name, an amount that may be 0 (BR-INC-04), and an
 * optional note. Skipping leaves the period without fixed expenses.
 */
export default function FixedExpensesStep() {
  const { t } = useTranslation();
  const flow = useSetupFlow();
  const currency = useSetupDraft((s) => s.currency) ?? 'USD';
  const fixedExpenses = useSetupDraft((s) => s.fixedExpenses);
  const setFixedExpenses = useSetupDraft((s) => s.setFixedExpenses);

  return (
    <ItemListForm
      title={t('setup.fixedExpenses.title')}
      description={t('setup.fixedExpenses.description')}
      addLabel={t('setup.fixedExpenses.add')}
      placeholder={t('setup.fixedExpenses.placeholder')}
      withNote
      editing={flow.editing}
      currency={currency}
      initial={fixedExpenses}
      onSubmit={(items) => {
        setFixedExpenses(items);
        flow.next('/setup/target');
      }}
      onSkip={() => {
        setFixedExpenses([]);
        flow.next('/setup/target');
      }}
    />
  );
}
