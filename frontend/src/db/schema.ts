// The on-device database (see docs/architecture/offline-sync.md). Screens read
// and write only these tables; the sync engine (`src/sync/`) sends the rows
// marked pending to the API. One database file holds one account's data.
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Returns the sync columns every table has, so the sync engine can push,
 * pull, and resolve conflicts the same way for every record (BR-OFF-03 to
 * BR-OFF-05).
 * @returns Column builders for `id`, `updated_at`, `deleted_at`, `pending`,
 *   `local_rev`, and `sync_error`.
 */
const syncColumns = () => ({
  /** A UUID made on the device (UUIDv7, or UUIDv5 for records every device must agree on). */
  id: text('id').primaryKey(),
  /** When the user made the change, in milliseconds since the epoch, by the device's clock. */
  updatedAt: integer('updated_at').notNull(),
  /** When the user deleted the record; the row stays as a tombstone. Null while it exists. */
  deletedAt: integer('deleted_at'),
  /** True while the API hasn't confirmed the latest change (BR-OFF-04). */
  pending: integer('pending', { mode: 'boolean' }).notNull().default(true),
  /** Increases with every local change, so a late confirmation can't clear a newer edit. */
  localRev: integer('local_rev').notNull().default(1),
  /**
   * Why the API rejected the latest change (e.g. `invalid_row`), or null. A
   * rejected row stays pending but isn't pushed again until the user changes
   * it (BR-OFF-04).
   */
  syncError: text('sync_error'),
});

/** The account's settings: one row, whose ID is the user ID. */
export const settings = sqliteTable('settings', {
  ...syncColumns(),
  /** The region whose default categories the account started with (BR-SET-06), e.g. `jp`. */
  region: text('region').notNull(),
  /** The account currency (BR-SET-03), which can't change (BR-SET-04). */
  currency: text('currency').notNull(),
  /** The day of the month periods start on, 1–31 (BR-PER-01). */
  periodStartDay: integer('period_start_day').notNull(),
  /** How big purchases are spread (BR-SET-05): `daysLeft` or `wholePeriod`. */
  bigPurchaseSpread: text('big_purchase_spread').notNull(),
  /** When setup finished (BR-ACC-06), in milliseconds since the epoch. */
  setupCompletedAt: integer('setup_completed_at').notNull(),
  /**
   * The end date of the next period, when a start-day change added the days
   * before the new start to it (BR-PER-05); null otherwise.
   */
  nextPeriodEnd: text('next_period_end'),
});

/** The user's categories (BR-CAT-01 to BR-CAT-03). */
export const categories = sqliteTable('categories', {
  ...syncColumns(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  /** Display order when recording an expense, from 0 (BR-CAT-02). */
  position: integer('position').notNull(),
  /** When the user archived it (BR-CAT-03); null while active. */
  archivedAt: integer('archived_at'),
});

/** Saving periods (BR-PER-01 to BR-PER-03). Dates are `YYYY-MM-DD`, both inclusive. */
export const periods = sqliteTable('periods', {
  ...syncColumns(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
});

/** Income items of a period (BR-INC-01). Amounts are in minor units (BR-NFR-06). */
export const incomes = sqliteTable('incomes', {
  ...syncColumns(),
  periodId: text('period_id').notNull(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  /** Display order in the period, from 0. */
  position: integer('position').notNull(),
});

/** Fixed expense items of a period (BR-INC-02). Amounts are in minor units. */
export const fixedExpenses = sqliteTable('fixed_expenses', {
  ...syncColumns(),
  periodId: text('period_id').notNull(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  note: text('note'),
  /** Display order in the period, from 0. */
  position: integer('position').notNull(),
});

/** The saving target of a period (BR-TGT-01): at most one per period, whose ID derives from the period's. */
export const savingTargets = sqliteTable('saving_targets', {
  ...syncColumns(),
  periodId: text('period_id').notNull(),
  amount: integer('amount').notNull(),
});

/**
 * The user's expenses (BR-EXP-01 to BR-EXP-05). An expense has no period ID:
 * it belongs to the period containing its date (BR-EXP-07), so changing the
 * date moves it without touching other rows.
 */
export const expenses = sqliteTable(
  'expenses',
  {
    ...syncColumns(),
    /** In minor units, greater than 0 (BR-EXP-08, BR-NFR-06). */
    amount: integer('amount').notNull(),
    categoryId: text('category_id').notNull(),
    /**
     * The calendar date in the device's time zone when it happened,
     * `YYYY-MM-DD` (BR-EXP-02). The calculations go by it, so it stays the
     * same day if the user later changes time zone.
     */
    date: text('date').notNull(),
    /** When it happened, in milliseconds since the epoch (BR-EXP-02). */
    spentAt: integer('spent_at').notNull(),
    /** Whether it is a big purchase (BR-EXP-05), which the allowance spreads over the days left. */
    isBigPurchase: integer('is_big_purchase', { mode: 'boolean' }).notNull().default(false),
    /** An optional description (BR-EXP-03); null when empty. */
    description: text('description'),
    /** Where it was recorded (BR-EXP-04), or null without a location. */
    latitude: real('latitude'),
    longitude: real('longitude'),
  },
  (table) => [index('expenses_date').on(table.date)],
);

/**
 * Extra income (BR-INC-06): money that arrives unplanned on a day, e.g. a
 * friend paying back their share of dinner. Like an expense, it has no period
 * ID: its date decides its period.
 */
export const extraIncomes = sqliteTable(
  'extra_incomes',
  {
    ...syncColumns(),
    /** In minor units, greater than 0 (BR-EXP-08, BR-NFR-06). */
    amount: integer('amount').notNull(),
    /** The calendar date in the device's time zone when it arrived, `YYYY-MM-DD`. */
    date: text('date').notNull(),
    /** When it arrived, in milliseconds since the epoch. */
    receivedAt: integer('received_at').notNull(),
    /** An optional description, e.g. "Aki paid back dinner"; null when empty. */
    description: text('description'),
  },
  (table) => [index('extra_incomes_date').on(table.date)],
);

/**
 * The sync engine's own state, on the device only: one row, whose `id` is 1.
 * Not synced.
 */
export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(),
  /** The highest change number pulled from the API; 0 before the first pull. */
  cursor: integer('cursor').notNull(),
});

/** Every synced table, for code that treats them alike (e.g. counting pending rows). */
export const syncedTables = [
  settings,
  categories,
  periods,
  incomes,
  fixedExpenses,
  savingTargets,
  expenses,
  extraIncomes,
] as const;
