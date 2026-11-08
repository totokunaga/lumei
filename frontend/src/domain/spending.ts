// Spending by category (BR-HIS-04) and the filters of a period's expense
// list (BR-EXP-10).
import type { Minor } from './money';

/** An expense as these rules need it. */
interface CategorizedExpense {
  amount: Minor;
  isBigPurchase: boolean;
  categoryId: string;
  categoryName: string;
  categoryEmoji: string;
}

/** One category's spending in a period (BR-HIS-04). */
export interface CategorySpending {
  categoryId: string;
  name: string;
  emoji: string;
  /** Σ its expenses in the period, big purchases at their full amount, in minor units. */
  amount: Minor;
  /** Its share of the period's spending, 0–1, e.g. 0.25 for a quarter. */
  share: number;
}

/** A period's spending, split by category (BR-HIS-04). */
export interface SpendingByCategory {
  /** Σ every expense in the period, big purchases included (BR-CALC-08). */
  total: Minor;
  /** The categories with spending, the largest first; equal amounts by name. */
  categories: CategorySpending[];
}

/**
 * Works out a period's spending by category (BR-HIS-04, BR-CALC-09): each
 * category's expenses, big purchases at their full amount, and its share of
 * the period's spending to date (BR-CALC-08). Fixed expenses have no
 * category, so they aren't counted. Categories without spending are left out.
 * @param expenses The period's expenses.
 * @returns The total and each category's amount and share; no categories
 *   when nothing was spent.
 */
export const spendingByCategory = (expenses: readonly CategorizedExpense[]): SpendingByCategory => {
  const byCategory = new Map<string, CategorySpending>();
  let total = 0;
  for (const expense of expenses) {
    total += expense.amount;
    const entry = byCategory.get(expense.categoryId) ?? {
      categoryId: expense.categoryId,
      name: expense.categoryName,
      emoji: expense.categoryEmoji,
      amount: 0,
      share: 0,
    };
    entry.amount += expense.amount;
    byCategory.set(expense.categoryId, entry);
  }
  const categories = [...byCategory.values()]
    .filter((entry) => entry.amount > 0)
    .map((entry) => ({ ...entry, share: total > 0 ? entry.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { total, categories };
};

/**
 * Which of a period's expenses the list shows (BR-EXP-10): all of them, only
 * the big purchases, or those of one or more categories.
 */
export type ExpenseFilter =
  | { kind: 'all' }
  | { kind: 'bigPurchases' }
  | { kind: 'categories'; categoryIds: readonly string[] };

/** A filter chip: all expenses, one category, or the big purchases (BR-EXP-10). */
export type FilterChip =
  { kind: 'all' } | { kind: 'bigPurchases' } | { kind: 'category'; categoryId: string };

/** The filter the list starts with. */
export const ALL_EXPENSES: ExpenseFilter = { kind: 'all' };

/**
 * Builds the filter that shows one category's expenses, e.g. for a category
 * tapped in the spending card (BR-HIS-04).
 * @returns A filter of that category alone.
 */
export const categoryFilter = (categoryId: string): ExpenseFilter => ({
  kind: 'categories',
  categoryIds: [categoryId],
});

/**
 * Keeps the expenses a filter shows, in their order (BR-EXP-10).
 * @returns The matching expenses; every one for `all`.
 */
export const filterExpenses = <T extends Pick<CategorizedExpense, 'isBigPurchase' | 'categoryId'>>(
  expenses: readonly T[],
  filter: ExpenseFilter,
): T[] => {
  switch (filter.kind) {
    case 'all':
      return [...expenses];
    case 'bigPurchases':
      return expenses.filter((expense) => expense.isBigPurchase);
    case 'categories':
      return expenses.filter((expense) => filter.categoryIds.includes(expense.categoryId));
  }
};

/**
 * Checks whether a chip shows as selected under a filter (BR-EXP-10): "All"
 * only when no category or big purchases are chosen, a category when it is
 * one of those chosen.
 * @returns True when the chip is selected.
 */
export const isChipSelected = (filter: ExpenseFilter, chip: FilterChip): boolean => {
  if (chip.kind === 'category') {
    return filter.kind === 'categories' && filter.categoryIds.includes(chip.categoryId);
  }
  return filter.kind === chip.kind;
};

/**
 * Works out the filter after a chip is tapped (BR-EXP-10). Categories add up:
 * tapping one adds it to those chosen, or removes it if chosen, and removing
 * the last shows all again. "All" and "Big purchases" each replace the
 * filter; tapping "Big purchases" again shows all.
 * @returns The new filter, e.g. Eat Out and Konbini after tapping Konbini
 *   with Eat Out chosen.
 */
export const toggleChip = (filter: ExpenseFilter, chip: FilterChip): ExpenseFilter => {
  switch (chip.kind) {
    case 'all':
      return ALL_EXPENSES;
    case 'bigPurchases':
      return filter.kind === 'bigPurchases' ? ALL_EXPENSES : { kind: 'bigPurchases' };
    case 'category': {
      const chosen = filter.kind === 'categories' ? filter.categoryIds : [];
      const categoryIds = chosen.includes(chip.categoryId)
        ? chosen.filter((id) => id !== chip.categoryId)
        : [...chosen, chip.categoryId];
      return categoryIds.length > 0 ? { kind: 'categories', categoryIds } : ALL_EXPENSES;
    }
  }
};

/**
 * Formats a share as a whole percentage, the app language's way; a share
 * above 0 that would round to 0 shows as "<1%", so no category with spending
 * reads as nothing.
 * @returns e.g. "25%" in English, "25 %" in French, or "<1%".
 */
export const formatShare = (share: number, locale: string): string => {
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  if (share > 0 && share < 0.005) {
    return `<${percent.format(0.01)}`;
  }
  return percent.format(share);
};
