# Account

The Account section of Settings shows who is signed in and whether every change has synced, lets the user sign out (removing the account's data from the device), and lets them delete the account after typing a confirmation word.

## Sub-features

- `acc-status` shows `Signed in as <email>` and `All changes synced`, or how many changes haven't synced or couldn't (BR-OFF-04).
- `acc-sign-out` asks `Sign out?`, warns when changes would be lost, returns to sign-in, and deletes the account's database file (BR-ACC-04).
- `acc-sign-back-in` signing in again downloads the synced data and skips setup (BR-ACC-06).
- `acc-delete` lists what is deleted, enables `Delete account` only once `DELETE` is typed, deletes every server row, and returns to sign-in (BR-ACC-05).

## How to get to it (user POV)

- Settings tab › the Account section at the bottom (`Signed in as …`, sync status, `Sign out`).
- Settings tab › `Delete account` row › the delete screen.

## Driving it with lumei-verify

Preconditions:

- Signed in as `verify@example.com` with setup finished, and at least one expense recorded ([Record an expense](./record-expense.md)).
- `$V doctor` is all OK.

- **Sync status.** Choose the Settings tab and scroll to Account. Run `$V tap --any "Settings" --exact`, `$V swipe 640 2200 640 600 400`, `$V wait --text "Signed in as verify@example.com"`. `All changes synced` shows once the expense has synced.
- **Unsynced count.** Stop the API's network path for the device with `adb -s emulator-5584 shell svc wifi disable` and `svc data disable`, record an expense, come back. `1 change not synced yet` shows. Re-enable both and wait for `All changes synced`.
- **Sign out.** Choose `Sign out`, then `Sign out` in the dialog. Run `$V tap --text "Sign out" --exact`, `$V wait --text "Sign out?"`, `$V tap --text "Sign out" --exact --index 1`. The sign-in screen returns. `$V device-sql "SELECT 1"` reports no account database.
- **Sign back in.** Sign in as the same email ([Sign in](./sign-in.md)). The home screen appears without setup, and the expense is in the list.
- **Delete account.** Choose `Delete account`, type the word, confirm. Run `$V tap --text "Delete account"`, `$V tap --desc "Type DELETE to confirm"`, `$V type "DELETE"`, `$V key BACK`, `$V tap --text "Delete account" --exact --index 1`. The sign-in screen returns.
- **Proof.** Before and after deletion, `$V sql "SELECT (SELECT count(*) FROM users WHERE email='verify@example.com') AS users, (SELECT count(*) FROM expenses) AS expenses" --save acc-delete`. After: both 0. Plus a `shot` of each screen.

## Gotchas

- Not yet driven end to end by this skill: the handles come from `en.json` and the screen code. Fix any that differ on the first run and note it here.
- `Sign out` and `Delete account` appear twice once the dialog or screen is open (row and confirm button); use `--index 1` for the second, and check with `ui` first.
- Turning the emulator's network off also cuts Metro; the running bundle keeps working, but don't reload the app until it is back on.
- Revoking Apple and Google access (BR-ACC-05) can't be proved: the dev sign-in has nothing to revoke. Report it as unverified.
- Deletion signing out *other* devices needs a second device; unverified with one emulator.
