// The setup a new user goes through before reaching the home screen
// (BR-ACC-06): region, currency, period start day, income, fixed expenses, and
// saving target, turned into the account's first records.
import type { BigPurchaseSpread } from './calculations';
import type { IsoDate } from './date';
import { type CurrencyCode, isCurrencyCode, type Minor } from './money';
import { periodContaining, type Period, type StartDay } from './period';

/** The languages default category names come in (BR-CAT-07). */
export type CategoryLanguage = 'en' | 'ja' | 'fr';

/** The region of the default category set for every region without its own, offered as "Other". */
export const GLOBAL_REGION = 'global';

/** A default category set from the seed data (BR-CAT-07), as `GET /category-sets` returns it. */
export interface DefaultCategorySet {
  region: string;
  name: Record<CategoryLanguage, string>;
  /** ISO 3166-1 alpha-2 device regions that preselect the set (BR-SET-06). */
  countries: string[];
  categories: { key: string; emoji: string; name: Record<CategoryLanguage, string> }[];
}

/** An income item entered at setup (BR-INC-01). */
export interface IncomeDraft {
  name: string;
  amount: Minor;
}

/** A fixed expense item entered at setup (BR-INC-02). */
export interface FixedExpenseDraft {
  name: string;
  amount: Minor;
  /** Null when the user left it empty. */
  note: string | null;
}

/** What the user chose during setup. Skipped steps keep their defaults (BR-ACC-06). */
export interface SetupChoices {
  set: DefaultCategorySet;
  currency: CurrencyCode;
  periodStartDay: StartDay;
  incomes: IncomeDraft[];
  fixedExpenses: FixedExpenseDraft[];
  /** Null when the user skipped the target step. */
  savingTarget: Minor | null;
}

/** The records setup creates, before the database adds its sync columns. */
export interface SetupRecords {
  settings: {
    id: string;
    region: string;
    currency: CurrencyCode;
    periodStartDay: StartDay;
    bigPurchaseSpread: BigPurchaseSpread;
    setupCompletedAt: number;
  };
  categories: { id: string; name: string; emoji: string; position: number }[];
  period: { id: string; startDate: IsoDate; endDate: IsoDate };
  incomes: { id: string; periodId: string; name: string; amount: Minor; position: number }[];
  fixedExpenses: {
    id: string;
    periodId: string;
    name: string;
    amount: Minor;
    note: string | null;
    position: number;
  }[];
  /** Null when the target step was skipped. */
  savingTarget: { id: string; periodId: string; amount: Minor } | null;
}

/** How setup makes record IDs (see `src/db/ids.ts`). */
export interface IdMaker {
  /** Makes a new, unique ID. */
  newId: () => string;
  /** Derives the same ID from the same parts on every device. */
  derivedId: (...parts: string[]) => string;
}

/** The period start day when the user skips that step (BR-PER-01). */
export const DEFAULT_START_DAY: StartDay = 1;

/**
 * Picks the region setup preselects from the device's region setting, not
 * from GPS (BR-SET-06). Any EU member state maps to the EU set, because the
 * seed data lists them all as its countries.
 * @param deviceRegion The device's ISO 3166-1 alpha-2 region code, e.g. `'FR'`, or null if unknown.
 * @returns The region of the first set listing the device region, e.g. `'eu'`
 *   for `'FR'`, or `'global'` ("Other") when no set does.
 */
export const detectRegion = (
  sets: readonly DefaultCategorySet[],
  deviceRegion: string | null | undefined,
): string => {
  const code = deviceRegion?.toUpperCase();
  return sets.find((set) => code && set.countries.includes(code))?.region ?? GLOBAL_REGION;
};

/** The currency of each region with one of its own (BR-SET-03). "Other" has none. */
const REGION_CURRENCIES: Partial<Record<string, CurrencyCode>> = {
  jp: 'JPY',
  us: 'USD',
  eu: 'EUR',
};

/**
 * Picks the currency setup suggests (BR-SET-03): the chosen region's, e.g.
 * JPY for Japan. For "Other", or a region the app doesn't know yet, the
 * device region's currency when it is supported, and USD otherwise.
 * @param region The chosen region, e.g. `'jp'`, or null before one is chosen.
 * @param deviceCurrency The device's ISO 4217 currency code, e.g. `'JPY'`, or null if unknown.
 * @returns e.g. `'EUR'` for `'eu'` on a device set to JPY; for `'global'`,
 *   `'JPY'` for `'JPY'`, and `'USD'` for an unsupported `'KRW'`.
 */
export const suggestCurrency = (
  region: string | null | undefined,
  deviceCurrency: string | null | undefined,
): CurrencyCode =>
  (region && REGION_CURRENCIES[region]) ||
  (deviceCurrency && isCurrencyCode(deviceCurrency) ? deviceCurrency : 'USD');

/**
 * Turns the user's setup choices into the account's first records: the
 * settings, the chosen region's default categories named in the app language
 * (BR-CAT-01, BR-CAT-06), the period containing today (BR-PER-01, BR-PER-02),
 * and its income, fixed expenses, and saving target (BR-INC-01, BR-INC-02,
 * BR-TGT-01). The settings, categories, period, and target get IDs derived
 * from the user and their content, so a second device setting up the same
 * account at the same time creates the same records rather than duplicates
 * (see docs/architecture/offline-sync.md). Names and notes are trimmed, and an
 * empty note becomes null.
 * @param language The app language at setup, which names the categories.
 * @param now When setup finished, in milliseconds since the epoch.
 * @returns The records to save, e.g. 9 categories for the Japan set.
 */
export const buildSetupRecords = (
  choices: SetupChoices,
  {
    userId,
    language,
    today,
    now,
    ids,
  }: { userId: string; language: CategoryLanguage; today: IsoDate; now: number; ids: IdMaker },
): SetupRecords => {
  const current: Period = periodContaining(today, choices.periodStartDay);
  const periodId = ids.derivedId(userId, 'period', current.start);

  return {
    settings: {
      id: userId,
      region: choices.set.region,
      currency: choices.currency,
      periodStartDay: choices.periodStartDay,
      bigPurchaseSpread: 'daysLeft',
      setupCompletedAt: now,
    },
    categories: choices.set.categories.map((category, position) => ({
      id: ids.derivedId(userId, 'category', category.key),
      name: category.name[language],
      emoji: category.emoji,
      position,
    })),
    period: { id: periodId, startDate: current.start, endDate: current.end },
    incomes: choices.incomes.map((item, position) => ({
      id: ids.newId(),
      periodId,
      name: item.name.trim(),
      amount: item.amount,
      position,
    })),
    fixedExpenses: choices.fixedExpenses.map((item, position) => ({
      id: ids.newId(),
      periodId,
      name: item.name.trim(),
      amount: item.amount,
      note: item.note?.trim() || null,
      position,
    })),
    savingTarget:
      choices.savingTarget === null
        ? null
        : {
            id: ids.derivedId(periodId, 'saving-target'),
            periodId,
            amount: choices.savingTarget,
          },
  };
};
