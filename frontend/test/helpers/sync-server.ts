// A fake of the sync API for one user, with the API's conflict rules and
// change numbers, so tests can sync several device databases through it. See
// docs/architecture/offline-sync.md.
import type { PullResponse, PushResponse, SyncRow } from '@/api/generated/model';
import { wins } from '@/domain/sync';

/** A row the fake server stores, with its change number. */
interface Stored {
  row: SyncRow;
  seq: number;
}

/**
 * Gives a pushed category the next free number in its name when another
 * stored category has it, ignoring case and spaces, as the API does
 * (BR-CAT-04), e.g. "Coffee (2)".
 * @returns The row as the server stores it.
 */
const withFreeName = (row: SyncRow, rows: Map<string, Stored>): SyncRow => {
  if (row.table !== 'categories' || row.deleted_at) {
    return row;
  }
  const key = (name: string) => name.trim().toLowerCase();
  const taken = new Set(
    [...rows.values()]
      .map((s) => s.row)
      .filter((r) => r.table === 'categories' && r.id !== row.id && !r.deleted_at)
      .map((r) => key((r as { name: string }).name)),
  );
  const name = row.name.trim();
  const numbered = /^(.*\S) \((\d+)\)$/.exec(name);
  const base = numbered ? numbered[1] : name;
  let next = numbered ? Number(numbered[2]) + 1 : 2;
  let candidate = name;
  while (taken.has(key(candidate))) {
    candidate = `${base} (${next++})`;
  }
  return { ...row, name: candidate };
};

/** Builds a JSON response. */
const respond = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/**
 * Starts an empty fake server.
 * @param pageSize How many rows a pull returns at most, 500 as the API by default.
 * @returns Its `mockApi` routes, and its stored rows to inspect.
 */
export const fakeSyncServer = ({ pageSize = 500 } = {}) => {
  const rows = new Map<string, Stored>();
  let seq = 0;

  const routes = {
    'POST /sync/push': (init: RequestInit | undefined, _url?: URL) => {
      const { rows: pushed } = JSON.parse(String(init?.body)) as { rows: SyncRow[] };
      const results: PushResponse['results'] = pushed.map((row) => {
        const key = `${row.table}/${row.id}`;
        const stored = rows.get(key);
        const incoming = { updatedAt: row.updated_at, deletedAt: row.deleted_at };
        if (
          stored &&
          !wins(incoming, { updatedAt: stored.row.updated_at, deletedAt: stored.row.deleted_at })
        ) {
          return { table: row.table, id: row.id, outcome: 'superseded' };
        }
        seq += 1;
        rows.set(key, { row: withFreeName(row, rows), seq });
        return { table: row.table, id: row.id, outcome: 'applied' };
      });
      return respond(200, { results });
    },
    'GET /sync/pull': (_init: RequestInit | undefined, url: URL) => {
      const since = Number(url.searchParams.get('since'));
      const changed = [...rows.values()].filter((s) => s.seq > since).sort((a, b) => a.seq - b.seq);
      const page = changed.slice(0, pageSize);
      const body: PullResponse = {
        rows: page.map((s) => s.row),
        cursor: page.at(-1)?.seq ?? since,
        has_more: changed.length > pageSize,
      };
      return respond(200, body);
    },
  };

  return {
    routes,
    /** The stored version of a record, or undefined. */
    stored: (table: string, id: string): SyncRow | undefined => rows.get(`${table}/${id}`)?.row,
    /** Stores a change as if another device pushed it. */
    store: (row: SyncRow) => {
      seq += 1;
      rows.set(`${row.table}/${row.id}`, { row, seq });
    },
    /** The last change number. */
    seq: () => seq,
  };
};
