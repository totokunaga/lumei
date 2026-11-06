// Reads and writes the account's records. Every write marks its rows pending,
// so the sync engine uploads them (BR-OFF-03, BR-OFF-04).
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import type { BigPurchaseSpread, PeriodRecords } from '@/domain/calculations';
import type { IsoDate } from '@/domain/date';
import { expenseDate } from '@/domain/expense';
import type { Minor } from '@/domain/money';
import type { Period, StartDay } from '@/domain/period';
import { nextPeriods, type PeriodRows } from '@/domain/rollover';
import type { SetupRecords } from '@/domain/setup';
import { type GapChoice, startDayChange } from '@/domain/start-day';

import { notifyChange } from './changes';
import type { Database } from './client';
import { derivedId, newId } from './ids';
import {
  categories,
  expenses,
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
 * Returns the sync columns of a row the user changed: pending again, at the
 * next revision, and with any earlier rejection cleared, so it is pushed
 * again (see docs/architecture/offline-sync.md).
 * @param now When the user made the change, in milliseconds since the epoch.
 */
const changed = (table: (typeof syncedTables)[number], now: number) => ({
  updatedAt: now,
  pending: true,
  syncError: null,
  localRev: sql`${table.localRev} + 1`,
});

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
  notifyChange();
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
    expenses: db
      .select({
        amount: expenses.amount,
        date: expenses.date,
        isBigPurchase: expenses.isBigPurchase,
      })
      .from(expenses)
      .where(
        and(
          gte(expenses.date, period.startDate),
          lte(expenses.date, period.endDate),
          isNull(expenses.deletedAt),
        ),
      )
      .all(),
  };
};

/** An expense as the home screen lists it, with its category (BR-DSH-06). */
export interface ListedExpense {
  id: string;
  /** In minor units. */
  amount: Minor;
  date: IsoDate;
  /** When it happened, in milliseconds since the epoch. */
  spentAt: number;
  isBigPurchase: boolean;
  categoryName: string;
  categoryEmoji: string;
  /**
   * Whether the API has it (BR-OFF-04): `synced`, `pending` until the next
   * sync, or `failed` when the API rejected it.
   */
  sync: SyncState;
}

/** Whether a record's latest change reached the API (BR-OFF-04). */
export type SyncState = 'synced' | 'pending' | 'failed';

/**
 * Reads the expenses of the period containing a date, newest first by when
 * each happened, for the home screen's list (BR-DSH-06). Expenses whose
 * category was archived still show it (BR-CAT-03). Deleted expenses are left
 * out.
 * @returns The expenses, the latest first; empty if no period contains the date.
 */
export const readPeriodExpenses = (db: Database, date: IsoDate): ListedExpense[] => {
  const period = db
    .select({ startDate: periods.startDate, endDate: periods.endDate })
    .from(periods)
    .where(and(lte(periods.startDate, date), gte(periods.endDate, date), isNull(periods.deletedAt)))
    .get();
  if (!period) {
    return [];
  }
  return (
    db
      .select({
        id: expenses.id,
        amount: expenses.amount,
        date: expenses.date,
        spentAt: expenses.spentAt,
        isBigPurchase: expenses.isBigPurchase,
        categoryName: categories.name,
        categoryEmoji: categories.emoji,
        pending: expenses.pending,
        syncError: expenses.syncError,
      })
      .from(expenses)
      .innerJoin(categories, eq(categories.id, expenses.categoryId))
      .where(
        and(
          gte(expenses.date, period.startDate),
          lte(expenses.date, period.endDate),
          isNull(expenses.deletedAt),
        ),
      )
      // IDs are UUIDv7s, so two expenses at the same moment list the later-recorded first.
      .orderBy(desc(expenses.spentAt), desc(expenses.id))
      .all()
      .map(({ pending, syncError, ...expense }) => ({
        ...expense,
        sync: syncError !== null ? 'failed' : pending ? 'pending' : 'synced',
      }))
  );
};

/** A category as offered when recording an expense. */
export type Category = Pick<typeof categories.$inferSelect, 'id' | 'name' | 'emoji'>;

/**
 * Reads the categories offered for a new expense: the active ones, in the
 * user's order (BR-CAT-02, BR-CAT-03).
 * @returns The categories, first position first.
 */
export const readCategories = (db: Database): Category[] =>
  db
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji })
    .from(categories)
    .where(and(isNull(categories.archivedAt), isNull(categories.deletedAt)))
    .orderBy(asc(categories.position))
    .all();

/**
 * Reads the start date of the account's first period, before which no
 * expense can be dated (BR-EXP-02).
 * @returns e.g. `'2026-11-01'`, or null before setup has finished.
 */
export const readFirstPeriodStart = (db: Database): IsoDate | null =>
  db
    .select({ startDate: periods.startDate })
    .from(periods)
    .where(isNull(periods.deletedAt))
    .orderBy(asc(periods.startDate))
    .get()?.startDate ?? null;

/** What the user enters to record an expense (BR-EXP-01, BR-EXP-02, BR-EXP-05). */
export interface NewExpense {
  /** In minor units, greater than 0 (BR-EXP-08). */
  amount: Minor;
  categoryId: string;
  /** When it happened, in milliseconds since the epoch; not later than now (BR-EXP-02). */
  spentAt: number;
  isBigPurchase: boolean;
}

/**
 * Saves a new expense, dated by the device's time zone at `spentAt`
 * (BR-EXP-02), and marks it pending for sync (BR-OFF-01). Screens showing
 * today's numbers update straight away (BR-NFR-04).
 * @param id The new expense's ID, from `newId()`.
 * @param now When the user saved it, in milliseconds since the epoch.
 * @throws If the write fails; nothing is saved then.
 */
export const addExpense = (db: Database, expense: NewExpense, id: string, now: number): void => {
  db.insert(expenses)
    .values({ ...expense, id, date: expenseDate(expense.spentAt), ...created(now) })
    .run();
  notifyChange();
};

/**
 * Reads the latest period with its items, which the next period copies
 * (BR-PER-03).
 * @returns The period's rows, or null before setup has finished.
 */
const readLatestPeriod = (db: Database): PeriodRows | null => {
  const period = db
    .select({ id: periods.id, startDate: periods.startDate, endDate: periods.endDate })
    .from(periods)
    .where(isNull(periods.deletedAt))
    .orderBy(desc(periods.startDate))
    .get();
  if (!period) {
    return null;
  }
  const items = <T extends typeof incomes | typeof fixedExpenses>(table: T) =>
    and(eq(table.periodId, period.id), isNull(table.deletedAt));
  return {
    period,
    incomes: db
      .select({
        id: incomes.id,
        periodId: incomes.periodId,
        name: incomes.name,
        amount: incomes.amount,
        position: incomes.position,
      })
      .from(incomes)
      .where(items(incomes))
      .all(),
    fixedExpenses: db
      .select({
        id: fixedExpenses.id,
        periodId: fixedExpenses.periodId,
        name: fixedExpenses.name,
        amount: fixedExpenses.amount,
        note: fixedExpenses.note,
        position: fixedExpenses.position,
      })
      .from(fixedExpenses)
      .where(items(fixedExpenses))
      .all(),
    savingTarget:
      db
        .select({
          id: savingTargets.id,
          periodId: savingTargets.periodId,
          amount: savingTargets.amount,
        })
        .from(savingTargets)
        .where(and(eq(savingTargets.periodId, period.id), isNull(savingTargets.deletedAt)))
        .get() ?? null,
  };
};

/**
 * Creates the periods missing up to the one containing today, each copying
 * the income, fixed expenses, and saving target of the one before
 * (BR-PER-03), in one transaction. Their IDs derive from what they copy, so
 * a record another device already created is left as it is.
 * @param now When it runs, in milliseconds since the epoch.
 * @returns How many periods it created: 0 while the latest one hasn't ended,
 *   or before setup has finished.
 * @throws If a write fails; nothing is saved then.
 */
export const ensureCurrentPeriod = (db: Database, today: IsoDate, now: number): number => {
  const account = readSettings(db);
  const latest = readLatestPeriod(db);
  if (!account || !latest) {
    return 0;
  }
  const newPeriods = nextPeriods(latest, {
    userId: account.id,
    startDay: account.periodStartDay,
    today,
    derivedId,
    nextPeriodEnd: account.nextPeriodEnd,
  });
  if (newPeriods.length === 0) {
    return 0;
  }
  const sync = created(now);
  db.transaction((tx) => {
    for (const rows of newPeriods) {
      tx.insert(periods)
        .values({ ...rows.period, ...sync })
        .onConflictDoNothing()
        .run();
      if (rows.incomes.length > 0) {
        tx.insert(incomes)
          .values(rows.incomes.map((row) => ({ ...row, ...sync })))
          .onConflictDoNothing()
          .run();
      }
      if (rows.fixedExpenses.length > 0) {
        tx.insert(fixedExpenses)
          .values(rows.fixedExpenses.map((row) => ({ ...row, ...sync })))
          .onConflictDoNothing()
          .run();
      }
      if (rows.savingTarget) {
        tx.insert(savingTargets)
          .values({ ...rows.savingTarget, ...sync })
          .onConflictDoNothing()
          .run();
      }
    }
  });
  notifyChange();
  return newPeriods.length;
};

/**
 * Counts the changes the API hasn't confirmed yet, across every table
 * (BR-OFF-04), including the ones it rejected.
 * @returns The number of pending rows: 0 when everything is synced.
 */
export const countPendingChanges = (db: Database): number =>
  syncedTables.reduce(
    (total, table) =>
      total + (db.select({ n: count() }).from(table).where(eq(table.pending, true)).get()?.n ?? 0),
    0,
  );

/**
 * Counts the changes the API rejected, across every table (BR-OFF-04). They
 * stay on the device until the user changes them.
 * @returns The number of rejected rows.
 */
export const countFailedChanges = (db: Database): number =>
  syncedTables.reduce(
    (total, table) =>
      total +
      (db
        .select({ n: count() })
        .from(table)
        .where(and(eq(table.pending, true), isNotNull(table.syncError)))
        .get()?.n ?? 0),
    0,
  );

/**
 * Chooses how big purchases are spread on the charts (BR-SET-05). Daily
 * allowances and period results don't change.
 * @param now When the user changed it, in milliseconds since the epoch.
 */
export const setBigPurchaseSpread = (
  db: Database,
  spread: BigPurchaseSpread,
  now: number,
): void => {
  db.update(settings)
    .set({ bigPurchaseSpread: spread, ...changed(settings, now) })
    .run();
  notifyChange();
};

/**
 * Reads the period containing a date.
 * @returns Its ID and dates, or null if no period contains the date.
 */
export const readPeriodOn = (db: Database, date: IsoDate): (Period & { id: string }) | null => {
  const period = db
    .select({ id: periods.id, start: periods.startDate, end: periods.endDate })
    .from(periods)
    .where(and(lte(periods.startDate, date), gte(periods.endDate, date), isNull(periods.deletedAt)))
    .get();
  return period ?? null;
};

/**
 * Changes the period start day (BR-PER-05). Past periods and the current
 * period's start keep their dates. The days between the current period's
 * end and the next new start go where `choice` says: the current period then
 * ends later, or the next period, created when this one ends, does.
 * @param today Today's date, which decides the current period.
 * @param now When the user changed it, in milliseconds since the epoch.
 * @throws If no period contains today, or a write fails; nothing is saved then.
 */
export const changeStartDay = (
  db: Database,
  startDay: StartDay,
  choice: GapChoice,
  today: IsoDate,
  now: number,
): void => {
  const current = readPeriodOn(db, today);
  if (!current) {
    throw new Error('No period contains today');
  }
  const change = startDayChange(current, startDay, choice);
  db.transaction((tx) => {
    tx.update(settings)
      .set({
        periodStartDay: startDay,
        nextPeriodEnd: change.nextPeriodEnd,
        ...changed(settings, now),
      })
      .run();
    if (change.currentEnd !== current.end) {
      tx.update(periods)
        .set({ endDate: change.currentEnd, ...changed(periods, now) })
        .where(eq(periods.id, current.id))
        .run();
    }
  });
  notifyChange();
};

/** The items of a period the user edits (BR-INC-01, BR-INC-02, BR-TGT-01). */
export interface PeriodItems {
  period: Period & { id: string };
  incomes: { id: string; name: string; amount: Minor }[];
  fixedExpenses: { id: string; name: string; amount: Minor; note: string | null }[];
  /** 0 when the period has no saving target. */
  savingTarget: Minor;
}

/**
 * Reads a period with its income, fixed expenses, and saving target, each
 * list in the user's order. Deleted items are left out.
 * @returns The items, or null if there is no such period.
 */
export const readPeriodItems = (db: Database, periodId: string): PeriodItems | null => {
  const period = db
    .select({ id: periods.id, start: periods.startDate, end: periods.endDate })
    .from(periods)
    .where(and(eq(periods.id, periodId), isNull(periods.deletedAt)))
    .get();
  if (!period) {
    return null;
  }
  const of = <T extends typeof incomes | typeof fixedExpenses>(table: T) =>
    and(eq(table.periodId, periodId), isNull(table.deletedAt));
  return {
    period,
    incomes: db
      .select({ id: incomes.id, name: incomes.name, amount: incomes.amount })
      .from(incomes)
      .where(of(incomes))
      .orderBy(asc(incomes.position))
      .all(),
    fixedExpenses: db
      .select({
        id: fixedExpenses.id,
        name: fixedExpenses.name,
        amount: fixedExpenses.amount,
        note: fixedExpenses.note,
      })
      .from(fixedExpenses)
      .where(of(fixedExpenses))
      .orderBy(asc(fixedExpenses.position))
      .all(),
    savingTarget:
      db
        .select({ amount: savingTargets.amount })
        .from(savingTargets)
        .where(and(eq(savingTargets.periodId, periodId), isNull(savingTargets.deletedAt)))
        .get()?.amount ?? 0,
  };
};

/** An income or fixed expense item as the user saves it: `id` is unset for a new one. */
export interface EditedItem {
  id?: string;
  name: string;
  amount: Minor;
  note: string | null;
}

/**
 * Saves a period's list of income or fixed expense items as the user left
 * it, in that order (BR-INC-01 to BR-INC-04). Only that period changes: other
 * periods keep their own items, and the next period copies these when it is
 * created (BR-INC-03). An item that didn't change isn't written, a removed
 * one is deleted, and a new one gets a new ID, so sync sends only what
 * changed.
 */
const saveItems = (
  db: Database,
  table: typeof incomes | typeof fixedExpenses,
  periodId: string,
  items: EditedItem[],
  now: number,
): void => {
  const withNote = table === fixedExpenses;
  const existing = new Map(
    db
      .select()
      .from(table)
      .where(and(eq(table.periodId, periodId), isNull(table.deletedAt)))
      .all()
      .map((row) => [row.id, row]),
  );
  db.transaction((tx) => {
    items.forEach((item, position) => {
      const values = {
        name: item.name,
        amount: item.amount,
        position,
        ...(withNote ? { note: item.note } : {}),
      };
      const stored = item.id ? existing.get(item.id) : undefined;
      if (!stored) {
        tx.insert(table)
          .values({ ...values, id: newId(), periodId, ...created(now) })
          .run();
        return;
      }
      existing.delete(stored.id);
      const same =
        stored.name === values.name &&
        stored.amount === values.amount &&
        stored.position === position &&
        (!withNote || ('note' in stored ? stored.note : null) === item.note);
      if (!same) {
        tx.update(table)
          .set({ ...values, ...changed(table, now) })
          .where(eq(table.id, stored.id))
          .run();
      }
    });
    for (const removed of existing.values()) {
      tx.update(table)
        .set({ deletedAt: now, ...changed(table, now) })
        .where(eq(table.id, removed.id))
        .run();
    }
  });
  notifyChange();
};

/**
 * Saves a period's income items (BR-INC-01, BR-INC-03, BR-INC-04).
 * @param now When the user saved them, in milliseconds since the epoch.
 * @throws If a write fails; nothing is saved then.
 */
export const saveIncomes = (db: Database, periodId: string, items: EditedItem[], now: number) =>
  saveItems(db, incomes, periodId, items, now);

/**
 * Saves a period's fixed expense items (BR-INC-02 to BR-INC-04).
 * @param now When the user saved them, in milliseconds since the epoch.
 * @throws If a write fails; nothing is saved then.
 */
export const saveFixedExpenses = (
  db: Database,
  periodId: string,
  items: EditedItem[],
  now: number,
) => saveItems(db, fixedExpenses, periodId, items, now);

/**
 * Sets a period's saving target (BR-TGT-01, BR-TGT-02); 0 clears it. The
 * target's ID derives from its period's, so it is never deleted, only set to
 * 0: a deleted row never comes back (see docs/architecture/offline-sync.md).
 * @param now When the user saved it, in milliseconds since the epoch.
 */
export const saveSavingTarget = (
  db: Database,
  periodId: string,
  amount: Minor,
  now: number,
): void => {
  const id = derivedId(periodId, 'saving-target');
  const stored = db.select().from(savingTargets).where(eq(savingTargets.id, id)).get();
  if (stored?.amount === amount) {
    return;
  }
  if (stored) {
    db.update(savingTargets)
      .set({ amount, ...changed(savingTargets, now) })
      .where(eq(savingTargets.id, id))
      .run();
  } else {
    db.insert(savingTargets)
      .values({ id, periodId, amount, ...created(now) })
      .run();
  }
  notifyChange();
};
