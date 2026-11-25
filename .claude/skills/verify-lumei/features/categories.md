# Categories

Categories lets a signed-in user add a category with an emoji and a name, rename it, reorder the list that new expenses offer, archive and unarchive one, and delete one that no expense uses, from Settings › Categories.

## Sub-features

- `cat-list` lists the region's default set in order, active first, archived under them by name (BR-CAT-01, BR-CAT-03).
- `cat-add` adds a category with one emoji and a name of at most 30 characters; it appears last and in the expense form (BR-CAT-02).
- `cat-unique` refuses a name that clashes without case or surrounding spaces, archived ones included (BR-CAT-04).
- `cat-archive` archives a category so new expenses don't offer it; unarchiving puts it last (BR-CAT-03).
- `cat-last-active` refuses to archive or delete the last active category (BR-CAT-03).
- `cat-delete` deletes an unused category with undo, and offers to archive a used one instead (BR-CAT-05).
- `cat-reorder` reorders by drag or by the screen reader's Move up / Move down (BR-CAT-02).

## How to get to it (user POV)

- Settings tab › `Categories` row › the list; `Add category` opens the new-category sheet.
- Tapping a category in the list opens its edit sheet (`Edit category`).

## Driving it with lumei-verify

Preconditions:

- Signed in and setup finished with region United States ([Setup](./setup.md)), so the list holds the US set: Eat Out, Coffee, Grocery, Gas, Transit, Friends, Leisure, Medical, Beauty, Fashion.
- `$V doctor` is all OK.

- **Open the list.** Choose the Settings tab, then Categories. Run `$V tap --any "Settings" --exact` (the tab bar's item), then `$V tap --text "Categories" --index 0` and `$V wait --text "Add category"`. The ten US categories show in order; `$V ui --save cat-list`.
- **Add.** Choose `Add category`. Run `$V tap --text "Add category"`, `$V wait --text "New category"`, `$V tap --desc "Emoji"`, `$V type "🍵"` (if `input text` rejects the emoji, see Gotchas), `$V tap --desc "Name"`, `$V type "Tea"`, `$V key BACK`, `$V tap --desc "Save" --exact`. The sheet closes and `Tea` is last in the list.
- **Clash.** Add another named ` tea ` the same way. `$V wait --text "You already have a category called"` shows and the sheet stays open.
- **Archive.** Open `Tea`, choose `Archive category`. Run `$V tap --text "Tea" --exact`, `$V tap --text "Archive category"`. The list shows `Tea` under `Archived` (`desc="Tea, archived"`), and a new expense's `Category` radio group no longer offers it.
- **Delete unused.** Add `Snacks`, open it, choose `Delete category`. A banner `Snacks deleted` with `Undo` appears; `Undo` puts it back in place.
- **Delete used.** Record an expense in `Coffee` ([Record an expense](./record-expense.md)), open `Coffee`, choose `Delete category`. A dialog `Coffee has 1 expense` offers to archive instead.
- **Proof.** `$V shot cat-after` and `$V ui --save cat-after`, then `$V device-sql "SELECT name, emoji, position, archived_at, deleted_at, pending FROM categories ORDER BY position" --save cat-device` and, after the sync, `$V sql "SELECT name, position, archived_at, deleted_at FROM categories ORDER BY position" --save cat-server`.

## Gotchas

- Not yet driven end to end by this skill: the handles come from `en.json` and the screen code. Fix any that differ on the first run and note it here.
- `adb shell input text` can't type most emoji. If the emoji field stays empty, report `cat-add` as blocked on emoji input rather than skipping the emoji; a name-only category isn't valid.
- Drag-to-reorder needs a long-press drag on the `≡` handle (`$V swipe X Y X Y2 1500` from the handle's bounds); it moves rows by transform, so read the new order from `device-sql`, not from `ui` bounds alone.
- Undo banners last 5 seconds (15 with a screen reader); tap `Undo` right after the delete.
- The two-device clash renaming (`Coffee (2)`) needs a second device; it can't be proved with one emulator.
