---
name: verify-offline-sync
description: Model-check Lumei's offline sync (push, pull, conflict rules, and the BR-CAT-05 category exception) with TLA+ after any change to the sync engine, the sync endpoints, the conflict rules, or the expense and category writes. Use before finishing a change to frontend/src/sync/, frontend/src/domain/sync.ts, the expense or category writes in frontend/src/db/records.ts, backend/internal/application/sync.go, or backend/internal/infrastructure/database/rdb/repository/sync.go, or when asked whether sync can lose a change, diverge between devices, or orphan an expense's category.
---

# Verify offline sync

A TLA+ model (`model/LumeiSync.tla`) of two devices syncing one account through the Go API. TLC checks every order of user writes, pushes, lost answers, and pulls within the bounds below. Tests check the orders someone wrote down; this checks them all.

## What it checks

Each property, the harm it guards against, and its requirement:

| Property | In plain words | Harm if broken |
|----------|----------------|----------------|
| `UsedCategoryKept` | The API never holds a live expense whose category is deleted or missing (BR-CAT-05, BR-CAT-03). | An expense shows with no category; history and trends lose it. |
| `Converged` | Once every device is idle, has nothing pending, and has pulled up to the API's last change, every device shows exactly what the API has (BR-OFF-03, BR-OFF-05). | Two phones show different data for good. |
| `NoChangeLost` | Once quiet, the API holds the winning change of every expense: the deletion if any device deleted it, else the change made last (BR-OFF-03, BR-OFF-05). | A user's edit silently disappears. |
| `SyncedRowsExist` | A device never treats a row as synced (`pending` false) that the API lacks (BR-OFF-03, BR-OFF-04). | The "not synced" mark vanishes for a change the server never got. |
| `ExpenseDeletionWins` | A deleted expense never comes back on the API (BR-OFF-05). | A deleted expense reappears. |
| `CategoryDeletionUndoneOnlyForExpense` | A deleted category comes back only for a live expense that has it, and archived (BR-OFF-05 rule 1, BR-CAT-05). | A deleted category is offered again for new expenses. |
| `DeletionHonored` | A pushed category deletion deletes the category unless a live expense still has it after the push, so an expense deleted or moved in the same push doesn't keep it (`applyOrder`, BR-CAT-05). | A category the user deleted lingers as archived. |

## Run it

From the repo root:

```sh
.claude/skills/verify-offline-sync/scripts/verify.sh
```

About 40 seconds on a laptop; add `--mutants` (about 70 seconds in all) after you edit the model, to prove each property can still fail. Needs Java 11 or later (`java -version`) and `curl`. The first run fetches TLA+ tools v1.7.4 (`tla2tools.jar`, SHA-256 pinned in the script) into `~/.cache/lumei-formal/`. Nothing else is installed.

It runs, in order:

1. **Drift check.** `scripts/fingerprint.sh` hashes each covered function (listed in `scripts/coverage.txt`) and compares with `scripts/coverage.lock`. A `DRIFT` line names each function whose text changed since the model was last confirmed against it.
2. **As-coded runs** (`as-coded/edit`, `as-coded/create`): every property except the two with known findings, on the model as the code is. Must `PASS`.
3. **One-snapshot-pull runs**: the same plus `Converged`, with the pull reading all tables at once (the fix for F1). Must `PASS`. This is what keeps `Converged` meaningful for every other part of the code while F1 stands.
4. **Known findings** F1 and F2 (below). Each must print `KNOWN` with its steps.

Exit codes: `0` all as expected; `1` a new property break (`FAIL`), a missed mutant, or a TLC error; `2` a known finding no longer reproduces (`FIXED?`); `3` the model passed but covered code drifted. Each run's config, TLC log, and counterexample are in the `TLC output:` folder the script prints, as `runN/run.cfg` and `runN/tlc.out`.

## Read every result with /statechart

Read each result with the pstack `/statechart` skill (`/pstack:statechart` in Claude Code), giving it `model/LumeiSync.tla` and the `run.cfg` of the run. For a break, it tells the shortest path to the bad state in plain words; for a pass, it draws how the sync moves between states. Then tell the path in this repo's words: "phone B's pull reads the categories", "phone A's push commits", and so on. The action names map to code in the table below.

## Does my change touch it?

If your diff touches a function in `scripts/coverage.txt`, or changes what a step below does, run the check. Run `scripts/fingerprint.sh` and compare with `scripts/coverage.lock` for a quick yes or no.

| Model (`LumeiSync.tla`) | Code |
|-------------------------|------|
| `Wins` | `application.Wins` in `backend/internal/application/sync.go`; `wins` in `frontend/src/domain/sync.ts` |
| `PushApplied`, `ApplyAll`, `ApplyRow` | `SyncUsecase.Push` and `apply` (sync.go), inside `SyncRepository.Apply`'s one transaction that locks `sync_state` (`repository/sync.go`) |
| `ApplyOrder`, `Sorted` | `applyOrder` (sync.go); rows pushed oldest `updatedAt` first by `readOutgoing` (`frontend/src/sync/engine.ts`) |
| `KeepUsedCategory`, `InUse` | `keepUsedCategory`, `SyncWriter.CategoryInUse` |
| `ReviveCategory` | `reviveCategory`, via `saveCategoryAware` |
| `Save`, `srv.seq`, `srv.n` | `syncWriter.Save` numbering rows with the user's next `change_seq` |
| `PushAnswered`, `sent` | `push` in engine.ts: clears `pending` where `localRev` is unchanged |
| `CycleFails` | `syncOnce` ending `offline`/`failed` (no network, lost answer) |
| `StartCycle`, one cycle per device | `requestSync` in `frontend/src/sync/scheduler.ts` |
| `PullReadCategories`, `PullReadExpenses` | `SyncRepository.Changes`: one SELECT per table (`changesOf`), outside any transaction, categories before expenses as in `readers` |
| `PullApplied`, `Keep` | `pull` and `applyPulled` in engine.ts: the page and the cursor in one SQLite transaction |
| `Write`, `pend`, `rev` | `created` and `changed` in `frontend/src/db/records.ts` |
| `AddExpense`, `EditExpense`, `DeleteExpense` | `addExpense` (picker offers `readCategories`), `updateExpense`, `deleteExpense` (BR-EXP-01, BR-EXP-06). The iOS shortcut's `ExpenseStore.addExpense` (BR-EXP-12) writes the same kind of row. |
| `AddCategory`, `EditCategory`, `ToggleArchived`, `DeleteCategory` | `addCategory`, `updateCategory`/`reorderCategories`, `setCategoryArchived` (last active can't be archived), `deleteCategory` after `countCategoryExpenses` is 0 (BR-CAT-02, BR-CAT-03, BR-CAT-05) |

Undo of a deletion (`restoreExpense`, `restoreCategory`) saves a new record with a new ID, so it is an `AddExpense`/`AddCategory` in the model.

## Real bug or modeling error?

When a run prints `FAIL`:

1. Get the path from `/statechart` and replay it against the code, one action per step, using the table above. Check each step's guard and effect in the real function.
2. If every step happens in the code, it is a real bug. Report it with the steps in the code's words. Don't weaken the property or the model to make it pass, and don't fix product code unless the user asks.
3. If a step can't happen in the code (a guard the model lacks, or a step the code does atomically that the model splits), the model is wrong. Fix the model, then run `--mutants` to show the properties still fail when they should.

## When the code changes on purpose

1. Change the model to match, step for step: one indivisible step in the code is one action in the model.
2. Run `scripts/verify.sh --mutants`. Update a mutant's `sed` in `verify.sh` if it prints `STALE`.
3. If a known finding was fixed (`FIXED?`), replace its `KNOWN` run with the property in the as-coded runs, and remove it from **Known findings**. For F1, the as-coded model then reads all tables in one step: set the as-coded runs' pull to `TRUE` and drop the what-if runs, or change `PullReadCategories`/`PullReadExpenses` to what the code does.
4. Only after you have confirmed the model describes the code, run `scripts/verify.sh --update-lock` and update **Last confirmed** below. Never update the lock just to silence `DRIFT`.

## Known findings

Both break with the code as it is. Neither is fixed here; the user decides.

**F1. A pull can skip another device's change for good** (`Converged`, BR-OFF-03). `SyncRepository.Changes` reads each table with its own SELECT on the pool, outside any transaction, so under PostgreSQL's default READ COMMITTED each table read sees a different moment. A push that commits between two of those reads can leave a gap below the new cursor:

1. Phone A renames category `c1` (or creates a category), then records expense `e1` in it. Both are pending.
2. Phone B starts a pull: `Changes` reads the categories table and finds nothing new.
3. Phone A's push commits: `c1` gets `change_seq` 2, `e1` gets 3.
4. Phone B's pull reads the expenses table and finds `e1` (3). The page's cursor becomes 3.
5. Phone B saves cursor 3. The next pull asks for changes after 3, so B never gets the rename, or, for a new category, has `e1` in a category it doesn't have, until that category changes again.

The same gap opens between any two tables read in `readers` order (settings, categories, periods, incomes, fixed expenses, saving targets, expenses, extra income). The model has categories and expenses only. Not replayed against a live PostgreSQL; the reasoning rests on each `changesOf` call being its own statement on `r.db`.

**F2. A deleted category can come back active, depending on which push arrives first** (`CategoryDeletionUndoneOnlyForExpense`, BR-CAT-05, BR-OFF-05 rule 1):

1. Phone B deletes category `c1`, which none of its expenses use (time 2).
2. Phone A, which hasn't heard of the deletion, records `e1` in `c1` (time 3) and renames `c1` (time 4).
3. B's push: `c1` is stored deleted.
4. A's push, in one transaction: `e1` is applied, and `reviveCategory` brings `c1` back archived, keeping the deletion's `updated_at` (2). Then A's rename (4) beats that archived row in `Wins` and is stored with `archived_at` empty.
5. `c1` ends active on every device and offered for new expenses. Had A's push arrived first, `keepUsedCategory` would have archived it, with B's copy of the name. The same happens when the rename comes in a later push.

## Bounds and assumptions

- Two devices (`d1`, `d2`, symmetric), categories `c1`, `c2`, one expense `e1`; three user changes per behavior (`MaxClock = 4`); the API's change counter up to 6 (`MaxSeq`). Scenario `edit` starts with both categories as defaults; `create` starts with `c1` and lets a device create `c2`.
- One clock for all devices, so no two changes share an `updated_at`, and clock skew and the 5-minute `future_change` rule are out.
- Rows are `exists`, `updated_at`, deleted, archived, and an expense's category. Names, emoji, positions, and amounts are left out, so BR-CAT-04's name numbering ("Coffee (2)") isn't checked.
- No rejected rows (`sync_error`), no batching (200 per push, 500 per pull, `has_more`), no `MAX_PUSHES` limit; a push carries every pending row.
- Only the categories and expenses tables; settings, periods, incomes, fixed expenses, saving targets, and extra income are left out, as are the BR-SET-04 currency rule and ownership checks.
- Only safety: it checks that nothing bad is reached, not that a sync eventually happens.
- A pass covers the model within these bounds, not the whole system.

## Last confirmed

The model was confirmed against the working tree on 2026-11-25, on top of commit `529d3b8`, while the sync code had uncommitted changes. The authority for what was confirmed is `scripts/coverage.lock`: a hash of each function in `scripts/coverage.txt`. When you confirm the model against newer code, run `--update-lock` and replace this paragraph with the commit you confirmed it at.
