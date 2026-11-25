# Record an expense

Recording an expense is Lumei's core loop: from the home screen, the user taps the add button, enters an amount, picks a category, and saves. The expense appears in the home list straight away, today's numbers change, the row is written to the on-device database marked not synced, and the next sync sends it to the server.

## Sub-features

- `exp-quick-add` home `Add expense` button › amount › category › `Save`, in three steps (BR-EXP-01, BR-EXP-09).
- `exp-amount-rules` an amount of 0, or with more decimals than the currency allows, shows `Enter an amount greater than 0, with no more decimals than the currency has.` (BR-EXP-08).
- `exp-optional` description, big purchase, date and time (not in the future), location (BR-EXP-02 to BR-EXP-05).
- `exp-live` the new row is in the home list, under `Today`, with its category, amount, and time, and today's numbers update (BR-DSH-04, BR-DSH-06, BR-NFR-04).
- `exp-device-row` the expense is in the device's SQLite with `pending = 1` until synced (BR-OFF-01, BR-OFF-04).
- `exp-sync` the sync sends it: the server's `expenses` row matches, and the device row's `pending` becomes 0 (BR-OFF-03).
- `exp-edit-delete` tapping the row opens `Edit expense`; `Delete expense` offers `Undo` (BR-EXP-06).

## How to get to it (user POV)

- Home tab › the floating `Add expense` button (bottom right, above the tab bar) › the `New expense` sheet.
- Home tab › an expense row › `Edit expense` (for edit and delete).
- The iOS Add Expense shortcut (BR-EXP-12) is another entry point; it can't be driven here (no iOS UI automation, and it runs in the Shortcuts app). Report it as unverified.

## Driving it with lumei-verify

Preconditions:

- Signed in as `verify@example.com` ([Sign in](./sign-in.md)) and setup finished with region United States and currency USD ([Setup](./setup.md)), so the categories include `Grocery`.
- Home shows `Remaining today`. `$V doctor` is all OK.

- **Before.** Run `$V ui --save exp-01-home-before` and `$V shot exp-01-home-before`. The list shows `No expenses yet this period.`
- **Open the sheet.** Choose `Add expense`. Run `$V tap --desc "Add expense"`. On the first open, Android asks `Allow Lumei to access this device’s location?`. Run `$V shot exp-02-location-prompt` and `$V tap --id "permission_deny_button"` (BR-EXP-04 without permission). Run `$V wait --text "New expense"`. The sheet shows `EditText text="0" desc="Amount"`, already focused, and one `RadioButton` per category (`desc="🛒, Grocery"`).
- **Amount.** Run `$V type "12.50"` and `$V key BACK`. The field reads `12.50`.
- **Category.** Run `$V tap --desc "Grocery"`. `RadioButton desc="🛒, Grocery"` shows `[Cxs]` (checked, selected). Run `$V shot exp-03-form-filled` and `$V ui --save exp-03-form-filled`.
- **Save.** Run `$V tap --desc "Save" --exact` and `$V gone --text "New expense"`.
- **On screen.** Run `$V wait --any "Grocery, \$12.50"`, `$V shot exp-04-home-after`, and `$V ui --save exp-04-home-after`. The list has `View desc="Today: $12.50 in total"` and `Button desc="Grocery, $12.50, Today, <h:mm AM/PM>"`, with `, Not synced yet` appended until the sync runs. A `🛒 Grocery` filter chip appears, `Spent today` is $12.50, and the chart reads `$12.50 over today's spending limit` when the budget is $0.
- **Device row.** Run `$V device-sql "SELECT e.amount, e.date, e.is_big_purchase, e.pending, e.sync_error, c.name AS category FROM expenses e JOIN categories c ON c.id = e.category_id" --save exp-05-device`. One row: `1250 | <today> | 0 | 0 | (null) | Grocery`. `pending` stays 1 until the sync has run.
- **Server row.** Run `$V sql "SELECT e.amount, e.date, e.is_big_purchase, c.name AS category, u.email FROM expenses e JOIN categories c ON c.id = e.category_id JOIN users u ON u.id = e.user_id" --save exp-06-server`. One row: `1250 | <today> | f | Grocery | verify@example.com`. If it isn't there yet, wait a few seconds and run it again; the app syncs on its own.
- **Proof.** Keep the before and after `shot` and `ui` files and the device and server rows, with `note` lines naming `exp-quick-add`, `exp-live`, `exp-device-row`, `exp-sync` and their BR IDs. The 2026-11-25 proof run is in `~/.cache/lumei-verify/evidence/20261125-155731/`.

## Gotchas

- Use `--desc "Save" --exact`: the edit sheet also has `Delete expense`, and other screens have `Save` in longer strings.
- The sync is fast against the local API, so `Not synced yet` usually never shows in a dump. Prove `exp-device-row` by the row existing, and `exp-sync` by `pending = 0` plus the server row. To see the mark, cut the device's network first (`adb -s emulator-5584 shell svc wifi disable` and `svc data disable`).
- Amounts are minor units on both sides: 12.50 USD is `1250`. A JPY account stores yen as-is.
- `adb shell input text` types `.` as a decimal point; with a French or Japanese emulator locale the field expects `,` or full-width input. Keep the emulator in English.
- Once denied, the location section shows `Location access is off…`. Verifying BR-EXP-04 needs `adb -s emulator-5584 shell pm grant com.anonymous.lumei android.permission.ACCESS_FINE_LOCATION` and `adb -s emulator-5584 emu geo fix <lon> <lat>` first. Android has no map without `GOOGLE_MAPS_API_KEY` at build time; it shows the coordinates instead.
- If sync misbehaves (row never leaves `pending`, `sync_error` set), check `git diff -- frontend/src/sync backend/internal/application/sync.go` and `build.txt` before blaming the app: another agent may have a scratch edit there.
