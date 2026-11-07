import {
  type ExpenseFilter,
  filterExpenses,
  formatShare,
  sameFilter,
  spendingByCategory,
} from '@/domain/spending';

/** Builds an expense in a category. */
const expense = (id: string, categoryId: string, amount: number, isBigPurchase = false) => ({
  id,
  amount,
  isBigPurchase,
  categoryId,
  categoryName: { food: 'Eat Out', shop: 'Konbini', tea: 'Tea' }[categoryId] ?? categoryId,
  categoryEmoji: { food: '🍔', shop: '🏪', tea: '🍵' }[categoryId] ?? '❓',
});

describe('spendingByCategory (BR-HIS-04, BR-CALC-09)', () => {
  it.each([
    {
      name: 'each category’s total and share, the largest first, big purchases in full',
      expenses: [
        expense('1', 'shop', 1_000),
        expense('2', 'food', 2_000),
        expense('3', 'food', 25_000, true),
        expense('4', 'shop', 2_000),
      ],
      expected: {
        total: 30_000,
        categories: [
          { categoryId: 'food', name: 'Eat Out', emoji: '🍔', amount: 27_000, share: 0.9 },
          { categoryId: 'shop', name: 'Konbini', emoji: '🏪', amount: 3_000, share: 0.1 },
        ],
      },
    },
    {
      name: 'equal amounts by name',
      expenses: [expense('1', 'tea', 500), expense('2', 'shop', 500)],
      expected: {
        total: 1_000,
        categories: [
          { categoryId: 'shop', name: 'Konbini', emoji: '🏪', amount: 500, share: 0.5 },
          { categoryId: 'tea', name: 'Tea', emoji: '🍵', amount: 500, share: 0.5 },
        ],
      },
    },
    { name: 'nothing without expenses', expenses: [], expected: { total: 0, categories: [] } },
  ])('returns $name', ({ expenses, expected }) => {
    expect(spendingByCategory(expenses)).toEqual(expected);
  });
});

describe('filterExpenses (BR-EXP-10)', () => {
  const expenses = [
    expense('1', 'food', 800),
    expense('2', 'shop', 28_000, true),
    expense('3', 'food', 1_200, true),
  ];

  it.each<{ name: string; filter: ExpenseFilter; ids: string[] }>([
    { name: 'every expense for all', filter: { kind: 'all' }, ids: ['1', '2', '3'] },
    { name: 'the big purchases', filter: { kind: 'bigPurchases' }, ids: ['2', '3'] },
    { name: 'one category’s', filter: { kind: 'category', categoryId: 'food' }, ids: ['1', '3'] },
    { name: 'none for a category without any', filter: { kind: 'category', categoryId: 'tea' }, ids: [] },
  ])('keeps $name, in order', ({ filter, ids }) => {
    expect(filterExpenses(expenses, filter).map((e) => e.id)).toEqual(ids);
  });

  it.each<{ name: string; a: ExpenseFilter; b: ExpenseFilter; same: boolean }>([
    { name: 'the same kind', a: { kind: 'all' }, b: { kind: 'all' }, same: true },
    { name: 'another kind', a: { kind: 'all' }, b: { kind: 'bigPurchases' }, same: false },
    {
      name: 'the same category',
      a: { kind: 'category', categoryId: 'food' },
      b: { kind: 'category', categoryId: 'food' },
      same: true,
    },
    {
      name: 'another category',
      a: { kind: 'category', categoryId: 'food' },
      b: { kind: 'category', categoryId: 'shop' },
      same: false,
    },
  ])('sameFilter is $same for $name', ({ a, b, same }) => {
    expect(sameFilter(a, b)).toBe(same);
  });
});

describe('formatShare (BR-HIS-04)', () => {
  it.each([
    { name: 'a whole percentage', share: 0.254, locale: 'en', text: '25%' },
    { name: 'the French way', share: 0.25, locale: 'fr', text: '25 %' },
    { name: '<1% for a share that rounds to 0', share: 0.004, locale: 'en', text: '<1%' },
    { name: '0% for nothing', share: 0, locale: 'en', text: '0%' },
  ])('writes $name', ({ share, locale, text }) => {
    // French separates the sign with a no-break space, narrow or not by engine.
    expect(formatShare(share, locale).replace(/\s/g, ' ')).toBe(text);
  });
});
