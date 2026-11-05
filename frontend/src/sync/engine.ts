// One sync cycle: push the device's pending changes, then pull other devices'
// changes (BR-OFF-03 to BR-OFF-05). See docs/architecture/offline-sync.md.
import { and, asc, eq, isNull } from 'drizzle-orm';

import { PushOutcome, type SyncRow } from '@/api/generated/model';
import { pullChanges, pushChanges } from '@/api/generated/sync/sync';
import { notifyChange } from '@/db/changes';
import type { Database } from '@/db/client';
import { syncedTables, syncState } from '@/db/schema';
import { wins } from '@/domain/sync';

import { fromSyncRow, type LocalRow, type SyncedTable, toSyncRow } from './rows';

/** The most rows one push carries, as the API allows. */
export const PUSH_LIMIT = 200;

/**
 * The most pushes one cycle sends. Each push confirms its rows, so this only
 * stops a cycle that makes no progress, e.g. while the user keeps editing.
 */
const MAX_PUSHES = 50;

/**
 * How a cycle ended:
 * - `synced`: everything pending was pushed, or rejected, and every change pulled.
 * - `offline`: the API couldn't be reached; the changes stay pending (BR-NFR-05).
 * - `failed`: the API answered with an error, e.g. after the session ended.
 */
export type SyncResult = 'synced' | 'offline' | 'failed';

/** A pending row read for a push, with the revision it was read at. */
interface Outgoing {
  table: SyncedTable;
  row: LocalRow;
}

/** The API answered with an error status, e.g. 401 after the session ended. */
class ApiError extends Error {}

/**
 * Reads the oldest pending changes the API hasn't rejected, across every table.
 * @returns Up to `PUSH_LIMIT` rows, oldest change first.
 */
const readOutgoing = (db: Database): Outgoing[] =>
  syncedTables
    .flatMap((table) =>
      db
        .select()
        .from(table)
        .where(and(eq(table.pending, true), isNull(table.syncError)))
        .orderBy(asc(table.updatedAt))
        .limit(PUSH_LIMIT)
        .all()
        .map((row): Outgoing => ({ table, row })),
    )
    .sort((a, b) => a.row.updatedAt - b.row.updatedAt)
    .slice(0, PUSH_LIMIT);

/**
 * Pushes every pending change, a batch at a time. A confirmed row stops being
 * pending, and a rejected one keeps its error, but only if it hasn't changed
 * since it was read: an edit made during the push goes in the next one.
 * @throws ApiError if the API answers with an error, or the network error.
 */
const push = async (db: Database): Promise<void> => {
  for (let i = 0; i < MAX_PUSHES; i++) {
    const outgoing = readOutgoing(db);
    if (outgoing.length === 0) {
      return;
    }
    const res = await pushChanges({
      rows: outgoing.map(({ table, row }) => toSyncRow(table, row)),
    });
    if (res.status !== 200) {
      throw new ApiError(`push answered ${res.status}`);
    }
    db.transaction((tx) => {
      res.data.results.forEach((result, index) => {
        const { table, row } = outgoing[index];
        const unchanged = and(eq(table.id, row.id), eq(table.localRev, row.localRev));
        if (result.outcome === PushOutcome.rejected) {
          tx.update(table)
            .set({ syncError: result.code ?? 'rejected' })
            .where(unchanged)
            .run();
        } else {
          tx.update(table).set({ pending: false }).where(unchanged).run();
        }
      });
    });
    notifyChange('sync');
  }
};

/**
 * Writes one pulled row. A row without a local change is overwritten. A row
 * with one goes through the conflict rules (BR-OFF-05): if the pulled version
 * wins, it replaces the local one, which stops being pending; otherwise the
 * local change stays, for the next push.
 */
const applyPulled = (tx: Pick<Database, 'select' | 'insert'>, row: SyncRow): void => {
  const converted = fromSyncRow(row);
  if (!converted) {
    return;
  }
  const { table, values } = converted;
  const local = tx
    .select({
      pending: table.pending,
      updatedAt: table.updatedAt,
      deletedAt: table.deletedAt,
      localRev: table.localRev,
    })
    .from(table)
    .where(eq(table.id, row.id))
    .get();
  if (local?.pending && !wins({ updatedAt: row.updated_at, deletedAt: row.deleted_at }, local)) {
    return;
  }
  const stored = { ...values, pending: false, syncError: null, localRev: local?.localRev ?? 1 };
  tx.insert(table)
    .values(stored as never)
    .onConflictDoUpdate({ target: table.id, set: stored })
    .run();
};

/**
 * Reads the highest change number pulled so far.
 * @returns 0 before the first pull.
 */
const readCursor = (db: Database): number =>
  db.select({ cursor: syncState.cursor }).from(syncState).where(eq(syncState.id, 1)).get()
    ?.cursor ?? 0;

/**
 * Pulls every change after the cursor, a page at a time. Each page's rows
 * and its cursor are saved in one transaction, so closing the app mid-pull
 * loses nothing.
 * @throws ApiError if the API answers with an error, or the network error.
 */
const pull = async (db: Database): Promise<void> => {
  let cursor = readCursor(db);
  for (;;) {
    const res = await pullChanges({ since: cursor });
    if (res.status !== 200) {
      throw new ApiError(`pull answered ${res.status}`);
    }
    const page = res.data;
    db.transaction((tx) => {
      for (const row of page.rows) {
        applyPulled(tx, row);
      }
      tx.insert(syncState)
        .values({ id: 1, cursor: page.cursor })
        .onConflictDoUpdate({ target: syncState.id, set: { cursor: page.cursor } })
        .run();
    });
    cursor = page.cursor;
    if (page.rows.length > 0) {
      notifyChange('sync');
    }
    if (!page.has_more) {
      return;
    }
  }
};

/**
 * Runs one sync cycle: pushes the pending changes, then pulls the changes
 * made on other devices. Run one cycle at a time (see `scheduler.ts`).
 * @returns How it ended. It never throws: without a network the app keeps
 *   working offline (BR-NFR-05).
 */
export const syncOnce = async (db: Database): Promise<SyncResult> => {
  try {
    await push(db);
    await pull(db);
    return 'synced';
  } catch (error) {
    // fetch fails with a TypeError when there is no network.
    return error instanceof TypeError ? 'offline' : 'failed';
  }
};
