import {
  buildSetupRecords,
  detectRegion,
  type IdMaker,
  type SetupChoices,
  suggestCurrency,
} from '@/domain/setup';

import { categorySets, japanSet } from '../helpers/category-sets';

describe('detectRegion (BR-SET-06)', () => {
  it.each([
    { name: 'the set listing the device region', deviceRegion: 'JP', expected: 'jp' },
    { name: 'the EU for any member state', deviceRegion: 'FR', expected: 'eu' },
    { name: 'a match in lower case', deviceRegion: 'de', expected: 'eu' },
    { name: '"Other" for a region without a set', deviceRegion: 'KR', expected: 'global' },
    { name: '"Other" when the device has no region', deviceRegion: null, expected: 'global' },
  ])('picks $name', ({ deviceRegion, expected }) => {
    expect(detectRegion(categorySets, deviceRegion)).toBe(expected);
  });
});

describe('suggestCurrency (BR-SET-03)', () => {
  it.each([
    { name: 'JPY for Japan', region: 'jp', deviceCurrency: 'USD', expected: 'JPY' },
    { name: 'USD for the United States', region: 'us', deviceCurrency: 'JPY', expected: 'USD' },
    { name: 'the euro for the EU', region: 'eu', deviceCurrency: 'SEK', expected: 'EUR' },
    { name: 'the device currency for "Other"', region: 'global', deviceCurrency: 'GBP', expected: 'GBP' },
    { name: 'the device currency for an unknown region', region: 'kr', deviceCurrency: 'SGD', expected: 'SGD' },
    { name: 'the device currency before a region', region: null, deviceCurrency: 'JPY', expected: 'JPY' },
    { name: 'USD for "Other" and an unsupported currency', region: 'global', deviceCurrency: 'KRW', expected: 'USD' },
    { name: 'USD for "Other" when the device has none', region: 'global', deviceCurrency: null, expected: 'USD' },
  ])('suggests $name', ({ region, deviceCurrency, expected }) => {
    expect(suggestCurrency(region, deviceCurrency)).toBe(expected);
  });
});

describe('buildSetupRecords (BR-ACC-06)', () => {
  /** Makes readable IDs: `new-1`, `new-2`, … and `derived(a/b)`. */
  const fakeIds = (): IdMaker => {
    let next = 0;
    return {
      newId: () => `new-${++next}`,
      derivedId: (...parts) => `derived(${parts.join('/')})`,
    };
  };
  const skipped: SetupChoices = {
    set: japanSet,
    currency: 'JPY',
    periodStartDay: 1,
    incomes: [],
    fixedExpenses: [],
    savingTarget: null,
  };
  const build = (choices: Partial<SetupChoices>, language: 'en' | 'ja' = 'en') =>
    buildSetupRecords(
      { ...skipped, ...choices },
      { userId: 'user-1', language, today: '2026-10-29', now: 1_000, ids: fakeIds() },
    );

  it.each([
    {
      name: 'the settings, with the days-left spread by default (BR-SET-05)',
      choices: {},
      expected: {
        settings: {
          id: 'user-1',
          region: 'jp',
          currency: 'JPY',
          periodStartDay: 1,
          bigPurchaseSpread: 'daysLeft',
          setupCompletedAt: 1_000,
        },
      },
    },
    {
      name: 'the calendar month containing today for start day 1 (BR-PER-01)',
      choices: {},
      expected: {
        period: { id: 'derived(user-1/period/2026-10-01)', startDate: '2026-10-01', endDate: '2026-10-31' },
      },
    },
    {
      name: 'the period from the start day, as in the spreadsheet (BR-PER-01)',
      choices: { periodStartDay: 25 },
      expected: {
        period: { id: 'derived(user-1/period/2026-10-25)', startDate: '2026-10-25', endDate: '2026-11-24' },
      },
    },
    {
      name: 'the trimmed items of the period, in order (BR-INC-01, BR-INC-02)',
      choices: {
        incomes: [{ name: ' Salary ', amount: 640_808 }],
        fixedExpenses: [
          { name: 'House Rent', amount: 0, note: ' Originally ¥50,000 ' },
          { name: 'Netflix', amount: 1_490, note: '  ' },
        ],
      },
      expected: {
        incomes: [
          { id: 'new-1', periodId: 'derived(user-1/period/2026-10-01)', name: 'Salary', amount: 640_808, position: 0 },
        ],
        fixedExpenses: [
          {
            id: 'new-2',
            periodId: 'derived(user-1/period/2026-10-01)',
            name: 'House Rent',
            amount: 0,
            note: 'Originally ¥50,000',
            position: 0,
          },
          {
            id: 'new-3',
            periodId: 'derived(user-1/period/2026-10-01)',
            name: 'Netflix',
            amount: 1_490,
            note: null,
            position: 1,
          },
        ],
      },
    },
    {
      name: 'the saving target, with an ID derived from its period (BR-TGT-01)',
      choices: { savingTarget: 100_000 },
      expected: {
        savingTarget: {
          id: 'derived(derived(user-1/period/2026-10-01)/saving-target)',
          periodId: 'derived(user-1/period/2026-10-01)',
          amount: 100_000,
        },
      },
    },
    {
      name: 'no saving target when the step was skipped',
      choices: {},
      expected: { savingTarget: null, incomes: [], fixedExpenses: [] },
    },
  ])('creates $name', ({ choices, expected }) => {
    expect(build(choices as Partial<SetupChoices>)).toMatchObject(expected);
  });

  it.each([
    {
      name: 'in English',
      language: 'en' as const,
      expected: [
        { id: 'derived(user-1/category/eat_out)', name: 'Eat Out', emoji: '🍔', position: 0 },
        { id: 'derived(user-1/category/konbini)', name: 'Konbini', emoji: '🏪', position: 1 },
      ],
    },
    {
      name: 'in Japanese',
      language: 'ja' as const,
      expected: [
        { id: 'derived(user-1/category/eat_out)', name: '外食', emoji: '🍔', position: 0 },
        { id: 'derived(user-1/category/konbini)', name: 'コンビニ', emoji: '🏪', position: 1 },
      ],
    },
  ])('names the region’s default categories $name (BR-CAT-01, BR-CAT-06)', ({ language, expected }) => {
    expect(build({}, language).categories).toEqual(expected);
  });
});
