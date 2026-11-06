import "@typespec/http";
import "@typespec/openapi";
import "./errors.tsp";

using Http;
using OpenAPI;

namespace Lumei;

// Syncing the records the app keeps on the device (BR-OFF-01 to BR-OFF-05).
// See docs/architecture/offline-sync.md for the protocol and conflict rules.
// Rows are sent whole: every field, plus the sync columns. Times are
// milliseconds since the epoch by the device's clock; dates are `YYYY-MM-DD`;
// amounts are integers in the account currency's minor unit (BR-NFR-06).

/** The sync columns every record has. */
model SyncColumns {
  /** A UUID made on the device. */
  @example("01963f5e-7a10-7c3e-9a51-8a3b6c1d2e4f") id: string;

  /** When the user made the change, by the device's clock (BR-OFF-05). */
  @example(1793865600000) updated_at: int64;

  /** When the user deleted the record, or null while it exists. The row stays as a tombstone. */
  deleted_at: int64 | null;
}

/** The account's settings: one row, whose ID is the user ID. */
model SettingsRow {
  table: "settings";
  ...SyncColumns;

  /** The region of the default categories (BR-SET-06), e.g. `jp`. */
  @example("jp") region: string;

  /** The account currency (BR-SET-03), an ISO 4217 code. It can't change (BR-SET-04). */
  @example("JPY") currency: string;

  /** The day of the month periods start on, 1–31 (BR-PER-01). */
  @example(25) period_start_day: int32;

  /** How big purchases are spread (BR-SET-05). */
  big_purchase_spread: "daysLeft" | "wholePeriod";

  /** When setup finished (BR-ACC-06). */
  setup_completed_at: int64;

  /**
   * The end date of the next period, `YYYY-MM-DD`, when a start-day change
   * added the days before the new start to it (BR-PER-05); null otherwise.
   * Older app versions leave it out.
   */
  @example("2026-12-31") next_period_end?: string | null;
}

/** A category (BR-CAT-01 to BR-CAT-03). */
model CategoryRow {
  table: "categories";
  ...SyncColumns;
  @example("Eat Out") name: string;
  @example("🍔") emoji: string;

  /** Display order when recording an expense, from 0 (BR-CAT-02). */
  position: int32;

  /** When the user archived it (BR-CAT-03), or null while active. */
  archived_at: int64 | null;
}

/** A saving period (BR-PER-01). Both dates are inclusive. */
model PeriodRow {
  table: "periods";
  ...SyncColumns;
  @example("2026-10-25") start_date: string;
  @example("2026-11-24") end_date: string;
}

/** An income item of a period (BR-INC-01). */
model IncomeRow {
  table: "incomes";
  ...SyncColumns;
  period_id: string;
  @example("Salary") name: string;
  @example(640808) amount: int64;

  /** Display order in the period, from 0. */
  position: int32;
}

/** A fixed expense item of a period (BR-INC-02). */
model FixedExpenseRow {
  table: "fixed_expenses";
  ...SyncColumns;
  period_id: string;
  @example("Rent") name: string;
  @example(85000) amount: int64;
  note: string | null;

  /** Display order in the period, from 0. */
  position: int32;
}

/** The saving target of a period (BR-TGT-01). */
model SavingTargetRow {
  table: "saving_targets";
  ...SyncColumns;
  period_id: string;
  @example(100000) amount: int64;
}

/** An expense (BR-EXP-01 to BR-EXP-05). */
model ExpenseRow {
  table: "expenses";
  ...SyncColumns;

  /** Greater than 0 (BR-EXP-08). */
  @example(1200) amount: int64;

  category_id: string;

  /** The calendar date in the device's time zone when it happened (BR-EXP-02). */
  @example("2026-11-05") date: string;

  /** When it happened. */
  spent_at: int64;

  /** Whether it is a big purchase (BR-EXP-05). */
  is_big_purchase: boolean;

  /** The optional description (BR-EXP-03). */
  description: string | null;

  /** Where it was recorded (BR-EXP-04), or null without a location. */
  latitude: float64 | null;

  longitude: float64 | null;
}

/** Extra income: money that arrives unplanned on a day (BR-INC-06). */
model ExtraIncomeRow {
  table: "extra_incomes";
  ...SyncColumns;

  /** Greater than 0 (BR-EXP-08). */
  @example(3000) amount: int64;

  /** The calendar date in the device's time zone when it arrived. */
  @example("2026-11-06") date: string;

  /** When it arrived. */
  received_at: int64;

  /** The optional description, e.g. "Aki paid back dinner". */
  description: string | null;
}

/** One record, whole, of any synced table. `table` says which. */
@discriminated(#{ envelope: "none", discriminatorPropertyName: "table" })
union SyncRow {
  settings: SettingsRow,
  categories: CategoryRow,
  periods: PeriodRow,
  incomes: IncomeRow,
  fixed_expenses: FixedExpenseRow,
  saving_targets: SavingTargetRow,
  expenses: ExpenseRow,
  extra_incomes: ExtraIncomeRow,
}

model PushRequest {
  /** Up to 200 rows, oldest change first. */
  @maxItems(200) rows: SyncRow[];
}

/**
 * What happened to a pushed row:
 * - `applied`: the API now has this change.
 * - `superseded`: the API already has a newer change, or a deletion; the next pull brings it.
 * - `rejected`: the row is invalid; `code` says why.
 */
enum PushOutcome {
  applied,
  superseded,
  rejected,
}

model PushResult {
  /** The table of the pushed row. */
  @example("expenses") table: string;

  /** The ID of the pushed row. */
  id: string;

  outcome: PushOutcome;

  /**
   * Why the row was rejected: `invalid_row` (a field is missing or out of
   * range), `not_owned` (the ID belongs to another user's record),
   * `future_change` (`updated_at` is more than 5 minutes ahead of the API's
   * clock, BR-OFF-05), or `currency_change` (BR-SET-04).
   */
  code?: string;
}

model PushResponse {
  /** One result per pushed row, in the order they were sent. */
  results: PushResult[];
}

model Pushed {
  @statusCode statusCode: 200;
  @body body: PushResponse;
}

model PullResponse {
  /** The user's rows changed after `since`, oldest change first, deleted ones included. */
  rows: SyncRow[];

  /** Send as `since` in the next pull. */
  @example(42) cursor: int64;

  /** True when more rows are waiting: pull again with the new cursor. */
  has_more: boolean;
}

model Pulled {
  @statusCode statusCode: 200;
  @body body: PullResponse;
}

@tag("sync")
interface Sync {
  /**
   * Stores the device's changes. Each row goes through the conflict rules
   * (BR-OFF-05): a deletion wins over any edit; otherwise the later
   * `updated_at` wins; on a tie, the stored version stays. Pushing the same
   * rows again changes nothing, so a lost response can be retried
   * (BR-OFF-03).
   *
   * Errors: 400 `invalid_request` when the body isn't a list of up to 200
   * rows of the known tables.
   */
  @summary("Push the device's changes")
  @operationId("pushChanges")
  @useAuth(BearerAuth)
  @post
  @route("/sync/push")
  push(@body body: PushRequest): Pushed | BadRequest | Unauthorized;

  /**
   * Returns up to 500 of the user's rows changed after the cursor, oldest
   * change first. A device that has never pulled sends 0.
   *
   * Errors: 400 `invalid_request` when `since` is missing or negative.
   */
  @summary("Pull changes from the user's other devices")
  @operationId("pullChanges")
  @useAuth(BearerAuth)
  @get
  @route("/sync/pull")
  pull(@query since: int64): Pulled | BadRequest | Unauthorized;
}
