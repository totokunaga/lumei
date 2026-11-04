import { useSetupDraft } from '@/setup/draft';

const amounts = {
  incomes: [{ name: 'Salary', amount: 300_000 }],
  fixedExpenses: [{ name: 'Rent', amount: 100_000, note: null }],
  savingTarget: 50_000,
};

describe('useSetupDraft.chooseCurrency (BR-EXP-08)', () => {
  beforeEach(() => useSetupDraft.getState().reset());

  it.each([
    {
      name: 'keeps the amounts when the currency is chosen first',
      before: null,
      after: 'JPY' as const,
      keeps: true,
    },
    {
      name: 'keeps the amounts when the same currency is chosen again',
      before: 'JPY' as const,
      after: 'JPY' as const,
      keeps: true,
    },
    {
      name: 'clears the amounts when another currency is chosen, since their decimals differ',
      before: 'JPY' as const,
      after: 'USD' as const,
      keeps: false,
    },
  ])('$name', ({ before, after, keeps }) => {
    useSetupDraft.setState({ currency: before, ...amounts });

    useSetupDraft.getState().chooseCurrency(after);

    expect(useSetupDraft.getState()).toMatchObject(
      keeps
        ? { currency: after, ...amounts }
        : { currency: after, incomes: [], fixedExpenses: [], savingTarget: null },
    );
  });
});
