// The on-device database (see docs/architecture/offline-sync.md). Screens read
// and write only these tables; the sync engine (phase 5) sends the rows marked
// pending to the API. One database file holds one account's data.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Returns the sync columns every table has, so the sync engine can push,
 * pull, and resolve conflicts the same way for every record (BR-OFF-03 to
 * BR-OFF-05).
 * @returns Column builders for `id`, `updated_at`, `deleted_at`, `pending`, and `local_rev`.
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

/** Every synced table, for code that treats them alike (e.g. counting pending rows). */
export const syncedTables = [
  settings,
  categories,
  periods,
  incomes,
  fixedExpenses,
  savingTargets,
] as const;
