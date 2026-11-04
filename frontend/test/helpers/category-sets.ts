// Default category sets as GET /category-sets returns them, trimmed to what
// tests need.
import type { DefaultCategorySet } from '@/domain/setup';

/** Builds a category with the same name in every language but Japanese. */
const category = (key: string, emoji: string, en: string, ja: string) => ({
  key,
  emoji,
  name: { en, ja, fr: `${en} (fr)` },
});

export const japanSet: DefaultCategorySet = {
  region: 'jp',
  name: { en: 'Japan', ja: '日本', fr: 'Japon' },
  countries: ['JP'],
  categories: [
    category('eat_out', '🍔', 'Eat Out', '外食'),
    category('konbini', '🏪', 'Konbini', 'コンビニ'),
  ],
};

export const euSet: DefaultCategorySet = {
  region: 'eu',
  name: { en: 'European Union', ja: '欧州連合（EU）', fr: 'Union européenne' },
  countries: ['DE', 'FR'],
  categories: [category('bakery', '🥖', 'Bakery', 'パン屋')],
};

export const globalSet: DefaultCategorySet = {
  region: 'global',
  name: { en: 'Other', ja: 'その他', fr: 'Autre' },
  countries: [],
  categories: [category('grocery', '🛒', 'Grocery', '食料品')],
};

/** Every set, in the order the API returns them. */
export const categorySets = [japanSet, euSet, globalSet];
