import {
  type ExpenseFilter,
  filterExpenses,
  type FilterChip,
  formatShare,
  isChipSelected,
  toggleChip,
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
    {
      name: 'one category’s',
      filter: { kind: 'categories', categoryIds: ['food'] },
      ids: ['1', '3'],
    },
    {
      name: 'several categories’',
      filter: { kind: 'categories', categoryIds: ['shop', 'food'] },
      ids: ['1', '2', '3'],
    },
    {
      name: 'none for a category without any',
      filter: { kind: 'categories', categoryIds: ['tea'] },
      ids: [],
    },
  ])('keeps $name, in order', ({ filter, ids }) => {
    expect(filterExpenses(expenses, filter).map((e) => e.id)).toEqual(ids);
  });
});

describe('expense filter chips (BR-EXP-10)', () => {
  const all: ExpenseFilter = { kind: 'all' };
  const big: ExpenseFilter = { kind: 'bigPurchases' };
  const food: FilterChip = { kind: 'category', categoryId: 'food' };
  const shop: FilterChip = { kind: 'category', categoryId: 'shop' };
  const foodAndShop: ExpenseFilter = { kind: 'categories', categoryIds: ['food', 'shop'] };

  it.each<{ name: string; filter: ExpenseFilter; chip: FilterChip; next: ExpenseFilter }>([
    { name: 'a category from all', filter: all, chip: food, next: { kind: 'categories', categoryIds: ['food'] } },
    {
      name: 'a second category to the first',
      filter: { kind: 'categories', categoryIds: ['food'] },
      chip: shop,
      next: foodAndShop,
    },
    {
      name: 'a chosen category off',
      filter: foodAndShop,
      chip: food,
      next: { kind: 'categories', categoryIds: ['shop'] },
    },
    { name: 'the last category off, to all', filter: { kind: 'categories', categoryIds: ['food'] }, chip: food, next: all },
    { name: 'all, clearing the categories', filter: foodAndShop, chip: { kind: 'all' }, next: all },
    { name: 'big purchases, replacing the categories', filter: foodAndShop, chip: { kind: 'bigPurchases' }, next: big },
    { name: 'big purchases off, to all', filter: big, chip: { kind: 'bigPurchases' }, next: all },
    { name: 'a category, replacing big purchases', filter: big, chip: food, next: { kind: 'categories', categoryIds: ['food'] } },
  ])('toggleChip turns $name', ({ filter, chip, next }) => {
    expect(toggleChip(filter, chip)).toEqual(next);
  });

  it.each<{ name: string; filter: ExpenseFilter; chip: FilterChip; selected: boolean }>([
    { name: 'all with nothing chosen', filter: all, chip: { kind: 'all' }, selected: true },
    { name: 'all with categories chosen', filter: foodAndShop, chip: { kind: 'all' }, selected: false },
    { name: 'a category with all', filter: all, chip: food, selected: false },
    { name: 'a chosen category', filter: foodAndShop, chip: shop, selected: true },
    { name: 'a category not chosen', filter: { kind: 'categories', categoryIds: ['food'] }, chip: shop, selected: false },
    { name: 'big purchases when chosen', filter: big, chip: { kind: 'bigPurchases' }, selected: true },
  ])('isChipSelected is $selected for $name', ({ filter, chip, selected }) => {
    expect(isChipSelected(filter, chip)).toBe(selected);
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
