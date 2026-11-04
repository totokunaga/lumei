// Reads and writes the account's records. Every write marks its rows pending,
// so the sync engine uploads them (BR-OFF-03, BR-OFF-04).
import { and, count, eq, gte, isNull, lte } from 'drizzle-orm';

import type { PeriodRecords } from '@/domain/calculations';
import type { SetupRecords } from '@/domain/setup';

import type { Database } from './client';
import {
  categories,
  fixedExpenses,
  incomes,
  periods,
  savingTargets,
  settings,
  syncedTables,
} from './schema';

/** The account settings as stored. */
export type Settings = typeof settings.$inferSelect;

/**
 * Returns the sync columns of a row the user just created.
 * @param now When the user made the change, in milliseconds since the epoch.
 * @returns `updatedAt` set to `now`, marked pending, at revision 1.
 */
const created = (now: number) => ({ updatedAt: now, pending: true, localRev: 1 });

/**
 * Saves everything setup creates in one transaction, so a failure leaves no
 * half-finished account (BR-ACC-06).
 * @param now When setup finished, in milliseconds since the epoch.
 * @throws If a write fails; nothing is saved then.
 */
export const saveSetup = (db: Database, records: SetupRecords, now: number): void => {
  const sync = created(now);
  db.transaction((tx) => {
    tx.insert(settings)
      .values({ ...records.settings, ...sync })
      .run();
    tx.insert(categories)
      .values(records.categories.map((row) => ({ ...row, ...sync })))
      .run();
    tx.insert(periods)
      .values({ ...records.period, ...sync })
      .run();
    if (records.incomes.length > 0) {
      tx.insert(incomes)
        .values(records.incomes.map((row) => ({ ...row, ...sync })))
        .run();
    }
    if (records.fixedExpenses.length > 0) {
      tx.insert(fixedExpenses)
        .values(records.fixedExpenses.map((row) => ({ ...row, ...sync })))
        .run();
    }
    if (records.savingTarget) {
      tx.insert(savingTargets)
        .values({ ...records.savingTarget, ...sync })
        .run();
    }
  });
};

/**
 * Reads the account settings.
 * @returns The settings, or null before setup has finished (BR-ACC-06).
 */
export const readSettings = (db: Database): Settings | null =>
  db.select().from(settings).where(isNull(settings.deletedAt)).get() ?? null;

/**
 * Reads the records of the period containing a date, which the calculations
 * need (BR-CALC). Deleted rows are left out, and a period without a saving
 * target counts it as 0.
 * @returns The period's records, with no expenses yet, or null if no period contains the date.
 */
export const readPeriodRecords = (db: Database, date: string): PeriodRecords | null => {
  const period = db
    .select()
    .from(periods)
    .where(and(lte(periods.startDate, date), gte(periods.endDate, date), isNull(periods.deletedAt)))
    .get();
  if (!period) {
    return null;
  }
  const amounts = (table: typeof incomes | typeof fixedExpenses) =>
    db
      .select({ amount: table.amount })
      .from(table)
      .where(and(eq(table.periodId, period.id), isNull(table.deletedAt)))
      .all()
      .map((row) => row.amount);
  const target = db
    .select({ amount: savingTargets.amount })
    .from(savingTargets)
    .where(and(eq(savingTargets.periodId, period.id), isNull(savingTargets.deletedAt)))
    .get();

  return {
    period: { start: period.startDate, end: period.endDate },
    income: amounts(incomes),
    fixedExpenses: amounts(fixedExpenses),
    savingTarget: target?.amount ?? 0,
    expenses: [],
  };
};

/**
 * Counts the changes the API hasn't confirmed yet, across every table
 * (BR-OFF-04).
 * @returns The number of pending rows: 0 when everything is synced.
 */
export const countPendingChanges = (db: Database): number =>
  syncedTables.reduce(
    (total, table) =>
      total + (db.select({ n: count() }).from(table).where(eq(table.pending, true)).get()?.n ?? 0),
    0,
  );
