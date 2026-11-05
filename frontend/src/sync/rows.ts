// Converts records between the device's tables and the sync API's rows. The
// API names every field as the device's SQLite column does (e.g.
// `category_id`), so one conversion fits every table: see
// docs/architecture/offline-sync.md.
import { getTableColumns, getTableName } from 'drizzle-orm';

import type { SyncRow } from '@/api/generated/model';
import { syncedTables } from '@/db/schema';

/** One of the synced tables. */
export type SyncedTable = (typeof syncedTables)[number];

/** A row of any synced table, as Drizzle reads it. */
export type LocalRow = SyncedTable['$inferSelect'];

/** The columns only the device has, which the API never sees. */
const deviceOnly = new Set(['pending', 'localRev', 'syncError']);

/** The synced tables by their name, e.g. `fixed_expenses`. */
const tablesByName = new Map<string, SyncedTable>(
  syncedTables.map((table) => [getTableName(table), table]),
);

/**
 * Lists a table's columns the API shares, with their names on both sides.
 * @returns e.g. `[['categoryId', 'category_id'], …]`.
 */
const sharedColumns = (table: SyncedTable): [key: string, name: string][] =>
  Object.entries(getTableColumns(table))
    .filter(([key]) => !deviceOnly.has(key))
    .map(([key, column]) => [key, column.name]);

/**
 * Converts a device row to the row the API stores.
 * @returns The row, whole, with `table` set.
 */
export const toSyncRow = (table: SyncedTable, row: LocalRow): SyncRow => {
  const out: Record<string, unknown> = { table: getTableName(table) };
  for (const [key, name] of sharedColumns(table)) {
    out[name] = (row as Record<string, unknown>)[key];
  }
  return out as unknown as SyncRow;
};

/**
 * Converts a pulled row to the values of its device table, without the
 * device's own columns. A field the API leaves out reads as null.
 * @returns The table and the values, or null for a table this app version
 *   doesn't have.
 */
export const fromSyncRow = (
  row: SyncRow,
): { table: SyncedTable; values: Record<string, unknown> } | null => {
  const table = tablesByName.get(row.table);
  if (!table) {
    return null;
  }
  const values: Record<string, unknown> = {};
  for (const [key, name] of sharedColumns(table)) {
    values[key] = (row as unknown as Record<string, unknown>)[name] ?? null;
  }
  return { table, values };
};
