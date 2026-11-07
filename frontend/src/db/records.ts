// Reads and writes the account's records. Every write marks its rows pending,
// so the sync engine uploads them (BR-OFF-03, BR-OFF-04).
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import type { BigPurchaseSpread, PeriodRecords } from '@/domain/calculations';
import { addDays, type IsoDate } from '@/domain/date';
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
  extraIncomes,
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
    extraIncome: db
      .select({ amount: extraIncomes.amount, date: extraIncomes.date })
      .from(extraIncomes)
      .where(
        and(
          gte(extraIncomes.date, period.startDate),
          lte(extraIncomes.date, period.endDate),
          isNull(extraIncomes.deletedAt),
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
  categoryId: string;
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
        categoryId: expenses.categoryId,
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
  /** An optional description (BR-EXP-03); null or omitted when empty. */
  description?: string | null;
  /** Where it happened (BR-EXP-04); null or omitted without a location. */
  latitude?: number | null;
  longitude?: number | null;
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

/** An expense as the edit form shows it (BR-EXP-06). */
export type StoredExpense = typeof expenses.$inferSelect;

/**
 * Reads an expense to edit.
 * @returns The expense, or null if there is none with the ID, or it was deleted.
 */
export const readExpense = (db: Database, id: string): StoredExpense | null =>
  db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), isNull(expenses.deletedAt)))
    .get() ?? null;

/**
 * Reads a category, archived or not, e.g. to show the one an expense in an
 * archived category keeps (BR-CAT-03).
 * @returns The category, or null if there is none with the ID.
 */
export const readCategory = (db: Database, id: string): Category | null =>
  db
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji })
    .from(categories)
    .where(eq(categories.id, id))
    .get() ?? null;

/**
 * Saves the user's changes to an expense (BR-EXP-03, BR-EXP-05, BR-EXP-06).
 * Its date follows a changed `spentAt`, which can move it to another period
 * (BR-EXP-07); otherwise it keeps its date, even after a change of time zone.
 * @param now When the user saved it, in milliseconds since the epoch.
 * @throws If the write fails; nothing is saved then.
 */
export const updateExpense = (db: Database, id: string, expense: NewExpense, now: number): void => {
  const stored = readExpense(db, id);
  if (!stored) {
    return;
  }
  db.update(expenses)
    .set({
      amount: expense.amount,
      categoryId: expense.categoryId,
      spentAt: expense.spentAt,
      isBigPurchase: expense.isBigPurchase,
      description: expense.description ?? null,
      latitude: expense.latitude ?? null,
      longitude: expense.longitude ?? null,
      date: expense.spentAt === stored.spentAt ? stored.date : expenseDate(expense.spentAt),
      ...changed(expenses, now),
    })
    .where(eq(expenses.id, id))
    .run();
  notifyChange();
};

/**
 * Deletes an expense (BR-EXP-06). The row stays as a deletion marker, so the
 * deletion syncs and wins over edits on other devices (BR-OFF-05).
 * @param now When the user deleted it, in milliseconds since the epoch.
 * @returns The expense as it was, for `restoreExpense`, or null if there is none.
 */
export const deleteExpense = (db: Database, id: string, now: number): StoredExpense | null => {
  const stored = readExpense(db, id);
  if (!stored) {
    return null;
  }
  db.update(expenses)
    .set({ deletedAt: now, ...changed(expenses, now) })
    .where(eq(expenses.id, id))
    .run();
  notifyChange();
  return stored;
};

/**
 * Undoes a deletion (BR-EXP-06): saves the deleted expense again, as a new
 * record. The deleted row can't come back, since a deletion always wins
 * (BR-OFF-05).
 * @param deleted The expense `deleteExpense` returned.
 * @param id The new record's ID, from `newId()`.
 * @param now When the user undid it, in milliseconds since the epoch.
 */
export const restoreExpense = (
  db: Database,
  deleted: StoredExpense,
  id: string,
  now: number,
): void => {
  db.insert(expenses)
    .values({
      id,
      amount: deleted.amount,
      categoryId: deleted.categoryId,
      date: deleted.date,
      spentAt: deleted.spentAt,
      isBigPurchase: deleted.isBigPurchase,
      description: deleted.description,
      latitude: deleted.latitude,
      longitude: deleted.longitude,
      ...created(now),
    })
    .run();
  notifyChange();
};

/**
 * Finds the periods just before and after one, for stepping through them
 * (BR-HIS-01). A period after the current one only exists once it starts.
 * @returns Each neighbour's ID and dates, or null where there is none.
 */
export const readNeighbourPeriods = (
  db: Database,
  period: Period,
): { previous: (Period & { id: string }) | null; next: (Period & { id: string }) | null } => {
  const columns = { id: periods.id, start: periods.startDate, end: periods.endDate };
  return {
    previous:
      db
        .select(columns)
        .from(periods)
        .where(and(lte(periods.endDate, addDays(period.start, -1)), isNull(periods.deletedAt)))
        .orderBy(desc(periods.startDate))
        .get() ?? null,
    next:
      db
        .select(columns)
        .from(periods)
        .where(and(gte(periods.startDate, addDays(period.end, 1)), isNull(periods.deletedAt)))
        .orderBy(asc(periods.startDate))
        .get() ?? null,
  };
};

/** Extra income as the home screen lists it (BR-INC-06, BR-DSH-06). */
export interface ListedIncome {
  id: string;
  /** In minor units. */
  amount: Minor;
  date: IsoDate;
  /** When it arrived, in milliseconds since the epoch. */
  receivedAt: number;
  description: string | null;
  /** Whether the API has it (BR-OFF-04). */
  sync: SyncState;
}

/**
 * Reads the extra income of the period containing a date, newest first by
 * when each arrived (BR-DSH-06). Deleted ones are left out.
 * @returns The income, the latest first; empty if no period contains the date.
 */
export const readPeriodExtraIncome = (db: Database, date: IsoDate): ListedIncome[] => {
  const period = readPeriodOn(db, date);
  if (!period) {
    return [];
  }
  return (
    db
      .select({
        id: extraIncomes.id,
        amount: extraIncomes.amount,
        date: extraIncomes.date,
        receivedAt: extraIncomes.receivedAt,
        description: extraIncomes.description,
        pending: extraIncomes.pending,
        syncError: extraIncomes.syncError,
      })
      .from(extraIncomes)
      .where(
        and(
          gte(extraIncomes.date, period.start),
          lte(extraIncomes.date, period.end),
          isNull(extraIncomes.deletedAt),
        ),
      )
      // IDs are UUIDv7s, so two incomes at the same moment list the later-recorded first.
      .orderBy(desc(extraIncomes.receivedAt), desc(extraIncomes.id))
      .all()
      .map(({ pending, syncError, ...income }) => ({
        ...income,
        sync: syncError !== null ? 'failed' : pending ? 'pending' : 'synced',
      }))
  );
};

/** What the user enters to record extra income (BR-INC-06). */
export interface NewExtraIncome {
  /** In minor units, greater than 0 (BR-EXP-08). */
  amount: Minor;
  /** When it arrived, in milliseconds since the epoch; not later than now (BR-EXP-02). */
  receivedAt: number;
  /** An optional description; null when empty. */
  description: string | null;
}

/** Extra income as the edit form shows it. */
export type StoredExtraIncome = typeof extraIncomes.$inferSelect;

/**
 * Saves new extra income, dated by the device's time zone at `receivedAt`,
 * and marks it pending for sync (BR-INC-06). Today's numbers update straight
 * away (BR-NFR-04).
 * @param id The new record's ID, from `newId()`.
 * @param now When the user saved it, in milliseconds since the epoch.
 * @throws If the write fails; nothing is saved then.
 */
export const addExtraIncome = (
  db: Database,
  income: NewExtraIncome,
  id: string,
  now: number,
): void => {
  db.insert(extraIncomes)
    .values({ ...income, id, date: expenseDate(income.receivedAt), ...created(now) })
    .run();
  notifyChange();
};

/**
 * Reads extra income to edit.
 * @returns It, or null if there is none with the ID, or it was deleted.
 */
export const readExtraIncome = (db: Database, id: string): StoredExtraIncome | null =>
  db
    .select()
    .from(extraIncomes)
    .where(and(eq(extraIncomes.id, id), isNull(extraIncomes.deletedAt)))
    .get() ?? null;

/**
 * Saves the user's changes to extra income (BR-INC-06). Its date follows a
 * changed `receivedAt`, which can move it to another period; otherwise it
 * keeps its date.
 * @param now When the user saved it, in milliseconds since the epoch.
 * @throws If the write fails; nothing is saved then.
 */
export const updateExtraIncome = (
  db: Database,
  id: string,
  income: NewExtraIncome,
  now: number,
): void => {
  const stored = readExtraIncome(db, id);
  if (!stored) {
    return;
  }
  db.update(extraIncomes)
    .set({
      ...income,
      date: income.receivedAt === stored.receivedAt ? stored.date : expenseDate(income.receivedAt),
      ...changed(extraIncomes, now),
    })
    .where(eq(extraIncomes.id, id))
    .run();
  notifyChange();
};

/**
 * Deletes extra income, keeping a marker for sync (BR-INC-06, BR-OFF-05).
 * @param now When the user deleted it, in milliseconds since the epoch.
 * @returns It as it was, for `restoreExtraIncome`, or null if there is none.
 */
export const deleteExtraIncome = (
  db: Database,
  id: string,
  now: number,
): StoredExtraIncome | null => {
  const stored = readExtraIncome(db, id);
  if (!stored) {
    return null;
  }
  db.update(extraIncomes)
    .set({ deletedAt: now, ...changed(extraIncomes, now) })
    .where(eq(extraIncomes.id, id))
    .run();
  notifyChange();
  return stored;
};

/**
 * Undoes a deletion: saves the deleted income again as a new record, since
 * the deleted row can't come back (BR-OFF-05).
 * @param id The new record's ID, from `newId()`.
 * @param now When the user undid it, in milliseconds since the epoch.
 */
export const restoreExtraIncome = (
  db: Database,
  deleted: StoredExtraIncome,
  id: string,
  now: number,
): void => {
  db.insert(extraIncomes)
    .values({
      id,
      amount: deleted.amount,
      date: deleted.date,
      receivedAt: deleted.receivedAt,
      description: deleted.description,
      ...created(now),
    })
    .run();
  notifyChange();
};

/** A category as the Categories screen and its edit sheet show it (BR-CAT-02, BR-CAT-03). */
export type ManagedCategory = Pick<
  typeof categories.$inferSelect,
  'id' | 'name' | 'emoji' | 'position' | 'archivedAt'
>;

/** The categories the user manages: those not deleted, split by whether they are archived. */
export interface ManagedCategories {
  /** The active ones, in the user's order (BR-CAT-02). */
  active: ManagedCategory[];
  /** The archived ones, by name (BR-CAT-03). */
  archived: ManagedCategory[];
}

/**
 * Reads every category that isn't deleted, for the Categories screen and the
 * name check (BR-CAT-02 to BR-CAT-04).
 * @returns The active ones in the user's order, and the archived ones by name.
 */
export const readManagedCategories = (db: Database): ManagedCategories => {
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      emoji: categories.emoji,
      position: categories.position,
      archivedAt: categories.archivedAt,
    })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(asc(categories.position), asc(categories.name))
    .all();
  return {
    active: rows.filter((row) => row.archivedAt === null),
    archived: rows
      .filter((row) => row.archivedAt !== null)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

/**
 * Reads a category to edit, archived or not.
 * @returns It, or null if there is none with the ID, or it was deleted.
 */
export const readManagedCategory = (db: Database, id: string): ManagedCategory | null =>
  db
    .select({
      id: categories.id,
      name: categories.name,
      emoji: categories.emoji,
      position: categories.position,
      archivedAt: categories.archivedAt,
    })
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .get() ?? null;

/** A category's name and emoji as the user typed them. */
export interface CategoryFields {
  name: string;
  emoji: string;
}

/**
 * Works out the position after every category's, so a new or unarchived one
 * comes last when recording an expense (BR-CAT-02).
 * @returns e.g. 8 when the highest position is 7; 0 without categories.
 */
const nextCategoryPosition = (db: Database): number =>
  (db
    .select({ highest: sql<number | null>`max(${categories.position})` })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .get()?.highest ?? -1) + 1;

/**
 * Saves a new category, last in the user's order, and marks it pending for
 * sync (BR-CAT-02). The caller checks that its name is free (BR-CAT-04).
 * @param id The new record's ID, from `newId()`.
 * @param now When the user saved it, in milliseconds since the epoch.
 * @throws If the write fails; nothing is saved then.
 */
export const addCategory = (
  db: Database,
  fields: CategoryFields,
  id: string,
  now: number,
): void => {
  db.insert(categories)
    .values({
      id,
      name: fields.name.trim(),
      emoji: fields.emoji,
      position: nextCategoryPosition(db),
      archivedAt: null,
      ...created(now),
    })
    .run();
  notifyChange();
};

/**
 * Renames a category or changes its emoji (BR-CAT-02). Its expenses show
 * the new name and emoji straight away. The caller checks that the name is
 * free (BR-CAT-04).
 * @param now When the user saved it, in milliseconds since the epoch.
 * @throws If the write fails; nothing is saved then.
 */
export const updateCategory = (
  db: Database,
  id: string,
  fields: CategoryFields,
  now: number,
): void => {
  db.update(categories)
    .set({ name: fields.name.trim(), emoji: fields.emoji, ...changed(categories, now) })
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .run();
  notifyChange();
};

/**
 * Archives a category, so it isn't offered for new expenses while past
 * expenses keep it, or unarchives it, last in the user's order (BR-CAT-03).
 * @param now When the user did it, in milliseconds since the epoch; also
 *   the archive's date.
 * @throws If the write fails; nothing is saved then.
 */
export const setCategoryArchived = (
  db: Database,
  id: string,
  archived: boolean,
  now: number,
): void => {
  db.update(categories)
    .set(
      archived
        ? { archivedAt: now, ...changed(categories, now) }
        : { archivedAt: null, position: nextCategoryPosition(db), ...changed(categories, now) },
    )
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .run();
  notifyChange();
};

/**
 * Saves the user's order of the active categories: the order shown when
 * recording an expense (BR-CAT-02). Only categories whose position changes
 * are written, so only they sync.
 * @param ids Every active category's ID, in the new order.
 * @param now When the user reordered them, in milliseconds since the epoch.
 * @throws If a write fails; nothing is saved then.
 */
export const reorderCategories = (db: Database, ids: readonly string[], now: number): void => {
  const current = new Map(
    readManagedCategories(db).active.map((category) => [category.id, category.position]),
  );
  db.transaction((tx) => {
    ids.forEach((id, position) => {
      if (current.has(id) && current.get(id) !== position) {
        tx.update(categories)
          .set({ position, ...changed(categories, now) })
          .where(eq(categories.id, id))
          .run();
      }
    });
  });
  notifyChange();
};
