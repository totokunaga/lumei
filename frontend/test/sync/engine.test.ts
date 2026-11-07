import { act, renderHook } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import type { SyncRow } from '@/api/generated/model';
import type { Database } from '@/db/client';
import { derivedId, newId } from '@/db/ids';
import {
  addExpense,
  addCategory,
  addExtraIncome,
  countPendingChanges,
  readCategories,
  readExtraIncome,
  readManagedCategories,
  saveSetup,
} from '@/db/records';
import { expenses, syncState } from '@/db/schema';
import { subscribeToLocalChanges, useDataVersion } from '@/db/changes';
import { localToday } from '@/domain/date';
import { buildSetupRecords } from '@/domain/setup';
import { syncOnce } from '@/sync/engine';

import { setupChoices } from '../helpers/account';
import { json, mockApi, offline, testUser } from '../helpers/api';
import { openDeviceDatabase } from '../helpers/database';
import { fakeSyncServer } from '../helpers/sync-server';

/** A device that finished setup, nothing synced yet: 7 pending rows. */
const deviceWithSetup = async (): Promise<Database> => {
  const db = await openDeviceDatabase();
  const now = Date.now();
  saveSetup(
    db,
    buildSetupRecords(setupChoices, {
      userId: testUser.id,
      language: 'en',
      today: localToday(),
      now,
      ids: { newId, derivedId },
    }),
    now,
  );
  return db;
};

/** Records an expense now on the device, in its first category. */
const spend = (db: Database, amount: number): string => {
  const id = newId();
  const now = Date.now();
  addExpense(db, { amount, categoryId: readCategories(db)[0].id, spentAt: now, isBigPurchase: false }, id, now);
  return id;
};

/** Reads an expense as stored on the device. */
const expense = (db: Database, id: string) => db.select().from(expenses).where(eq(expenses.id, id)).get();

/** Changes an expense on the device as the user would: a new revision, pending. */
const edit = (db: Database, id: string, changes: Partial<typeof expenses.$inferInsert>) => {
  const row = expense(db, id)!;
  db.update(expenses)
    .set({ ...changes, pending: true, syncError: null, localRev: row.localRev + 1 })
    .where(eq(expenses.id, id))
    .run();
};

describe('syncOnce (BR-OFF-03 to BR-OFF-05)', () => {
  it('pushes every pending row whole, and another device pulls them', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    const tablet = await openDeviceDatabase();

    expect(await syncOnce(phone)).toBe('synced');
    expect(await syncOnce(tablet)).toBe('synced');

    expect(countPendingChanges(phone)).toBe(0);
    expect(server.stored('expenses', id)).toEqual({
      table: 'expenses',
      id,
      updated_at: expense(phone, id)!.updatedAt,
      deleted_at: null,
      amount: 1_200,
      category_id: readCategories(phone)[0].id,
      date: expense(phone, id)!.date,
      spent_at: expense(phone, id)!.spentAt,
      is_big_purchase: false,
      description: null,
      latitude: null,
      longitude: null,
    });
    // The other device has every record, synced, and the cursor after them.
    expect(expense(tablet, id)).toEqual({ ...expense(phone, id), pending: false });
    expect(readCategories(tablet)).toEqual(readCategories(phone));
    expect(countPendingChanges(tablet)).toBe(0);
    expect(tablet.select().from(syncState).get()).toEqual({ id: 1, cursor: server.seq() });
  });

  it('syncs extra income like every other record (BR-INC-06)', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    const id = newId();
    addExtraIncome(phone, { amount: 3_000, receivedAt: Date.now(), description: 'Dinner' }, id, Date.now());
    const tablet = await openDeviceDatabase();

    await syncOnce(phone);
    await syncOnce(tablet);

    expect(server.stored('extra_incomes', id)).toMatchObject({ amount: 3_000, description: 'Dinner' });
    expect(readExtraIncome(tablet, id)).toEqual({ ...readExtraIncome(phone, id), pending: false });
  });

  it.each([
    { name: 'offline without a network (BR-NFR-05)', respond: offline, expected: 'offline' },
    {
      name: 'failed when the API answers with an error',
      respond: json(500, { code: 'internal_error', message: '' }),
      expected: 'failed',
    },
  ])('is $name, and keeps the changes pending', async ({ respond, expected }) => {
    mockApi({ 'POST /sync/push': respond, 'GET /sync/pull': respond });
    const phone = await deviceWithSetup();

    expect(await syncOnce(phone)).toBe(expected);
    expect(countPendingChanges(phone)).toBe(7);
  });

  it('keeps a rejected row pending with its error, and doesn’t push it again (BR-OFF-04)', async () => {
    const server = fakeSyncServer();
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    const push = jest.fn(server.routes['POST /sync/push']);
    mockApi({
      ...server.routes,
      'POST /sync/push': [
        (init) => {
          const { rows } = JSON.parse(String(init?.body)) as { rows: { table: string; id: string }[] };
          const results = rows.map((row) => ({
            table: row.table,
            id: row.id,
            outcome: row.id === id ? 'rejected' : 'applied',
            ...(row.id === id ? { code: 'invalid_row' } : {}),
          }));
          return json(200, { results })();
        },
        push,
      ],
    });

    expect(await syncOnce(phone)).toBe('synced');
    expect(await syncOnce(phone)).toBe('synced');

    expect(expense(phone, id)).toMatchObject({ pending: true, syncError: 'invalid_row' });
    expect(countPendingChanges(phone)).toBe(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps an edit made during the push pending, for the next push', async () => {
    const server = fakeSyncServer();
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    mockApi({
      ...server.routes,
      'POST /sync/push': [
        (init, url) => {
          edit(phone, id, { amount: 1_500, updatedAt: Date.now() + 1 });
          return server.routes['POST /sync/push'](init, url);
        },
        server.routes['POST /sync/push'],
      ],
    });

    await syncOnce(phone);

    // The first push sent ¥1,200; the edit went in a second push of the same cycle.
    expect(expense(phone, id)).toMatchObject({ amount: 1_500, pending: false });
    expect(server.stored('expenses', id)).toMatchObject({ amount: 1_500 });
  });

  it('settles an expense changed on two devices on the change made last (BR-OFF-05)', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    const tablet = await openDeviceDatabase();
    await syncOnce(phone);
    await syncOnce(tablet);

    // Offline, the tablet changes it first and the phone later; the tablet syncs first.
    const { updatedAt } = expense(phone, id)!;
    edit(tablet, id, { amount: 2_000, updatedAt: updatedAt + 1_000 });
    edit(phone, id, { amount: 3_000, updatedAt: updatedAt + 2_000 });
    await syncOnce(tablet);
    await syncOnce(phone);
    await syncOnce(tablet);

    for (const device of [phone, tablet]) {
      expect(expense(device, id)).toMatchObject({ amount: 3_000, pending: false });
    }
    expect(server.stored('expenses', id)).toMatchObject({ amount: 3_000 });
  });

  it('keeps a local change that is later than the pulled one, and pushes it next', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    await syncOnce(phone);
    const { updatedAt } = expense(phone, id)!;
    // Another device's change reaches the server; the phone's own, later, waits offline.
    server.store({ ...server.stored('expenses', id)!, amount: 2_000, updated_at: updatedAt + 1_000 } as SyncRow);
    edit(phone, id, { amount: 3_000, updatedAt: updatedAt + 2_000 });
    mockApi({ ...server.routes, 'POST /sync/push': offline });

    await syncOnce(phone);
    expect(expense(phone, id)).toMatchObject({ amount: 3_000, pending: true });

    mockApi(server.routes);
    await syncOnce(phone);
    expect(server.stored('expenses', id)).toMatchObject({ amount: 3_000 });
  });

  it('lets a deletion win over a later edit on another device (BR-OFF-05)', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    const tablet = await openDeviceDatabase();
    await syncOnce(phone);
    await syncOnce(tablet);

    const { updatedAt } = expense(phone, id)!;
    edit(phone, id, { updatedAt: updatedAt + 1_000, deletedAt: updatedAt + 1_000 });
    edit(tablet, id, { amount: 2_000, updatedAt: updatedAt + 2_000 });
    await syncOnce(phone);
    await syncOnce(tablet);

    expect(expense(tablet, id)).toMatchObject({ amount: 1_200, deletedAt: updatedAt + 1_000, pending: false });
  });

  it('pushes again after a lost response, and the change is stored once (BR-OFF-03)', async () => {
    const server = fakeSyncServer();
    const phone = await deviceWithSetup();
    const id = spend(phone, 1_200);
    mockApi({
      ...server.routes,
      // The server stores the push, but the response never arrives.
      'POST /sync/push': [
        async (init, url) => {
          await server.routes['POST /sync/push'](init, url);
          throw new TypeError('Network request failed');
        },
        server.routes['POST /sync/push'],
      ],
    });

    expect(await syncOnce(phone)).toBe('offline');
    const seq = server.seq();
    expect(await syncOnce(phone)).toBe('synced');

    expect(countPendingChanges(phone)).toBe(0);
    expect(server.seq()).toBe(seq);
    expect(server.stored('expenses', id)).toMatchObject({ amount: 1_200 });
  });

  it('renames a category added with the same name on two devices offline, on both (BR-CAT-04)', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    await syncOnce(phone);
    const tablet = await openDeviceDatabase();
    await syncOnce(tablet);

    addCategory(phone, { name: 'Coffee', emoji: '☕' }, newId(), Date.now());
    addCategory(tablet, { name: 'coffee', emoji: '🫘' }, newId(), Date.now());
    await syncOnce(phone);
    await syncOnce(tablet);
    await syncOnce(phone);

    /** Reads the device's categories named like coffee. */
    const names = (db: Database) =>
      readManagedCategories(db)
        .active.map((category) => category.name)
        .filter((name) => name.toLowerCase().startsWith('coffee'));
    expect(names(phone)).toEqual(['Coffee', 'coffee (2)']);
    expect(names(tablet)).toEqual(['Coffee', 'coffee (2)']);
    expect(countPendingChanges(tablet)).toBe(0);
  });

  it('pulls page after page, and skips tables this app version doesn’t have', async () => {
    const server = fakeSyncServer({ pageSize: 2 });
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    await syncOnce(phone);
    server.store({ table: 'budgets', id: newId(), updated_at: 1, deleted_at: null } as never);
    const tablet = await openDeviceDatabase();

    expect(await syncOnce(tablet)).toBe('synced');

    expect(readCategories(tablet)).toEqual(readCategories(phone));
    expect(tablet.select().from(syncState).get()).toEqual({ id: 1, cursor: server.seq() });
  });

  it('tells screens about pulled changes without starting another sync', async () => {
    const server = fakeSyncServer();
    mockApi(server.routes);
    const phone = await deviceWithSetup();
    await syncOnce(phone);
    const tablet = await openDeviceDatabase();
    const local = jest.fn();
    const unsubscribe = subscribeToLocalChanges(local);
    const { result } = await renderHook(() => useDataVersion());
    const before = result.current;

    await act(() => syncOnce(tablet));

    expect(result.current).toBeGreaterThan(before);
    expect(local).not.toHaveBeenCalled();
    unsubscribe();
  });
});
