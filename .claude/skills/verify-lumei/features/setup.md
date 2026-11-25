# Setup

Setup is the short first-run flow a new account goes through before the home screen: region and language (with the world map and the categories the region starts with), currency, period start day, income, fixed expenses, and saving target, then a summary where each choice can be changed before `Start using Lumei`.

## Sub-features

- `setup-region` preselects the device's region (United States here), shows the map and `You'll start with` the region's categories; can't be skipped (BR-SET-06, BR-CAT-01).
- `setup-currency` suggests the region's currency (USD) and says `You can't change the currency after setup.`; can't be skipped (BR-SET-03, BR-SET-04).
- `setup-start-day` picks the period start day from a calendar, default 1 (BR-PER-01, BR-PER-02).
- `setup-income` and `setup-fixed` add named items with amounts; 0 is allowed for fixed expenses (BR-INC-01, BR-INC-02, BR-INC-04).
- `setup-target` sets the saving target and shows `You can spend … this period.`, warning when it exceeds income − fixed (BR-TGT-01, BR-TGT-03).
- `setup-skip` every step after currency has `Skip for now` (BR-ACC-06).
- `setup-confirm` the summary lists each choice; tapping one opens its step and `Done` returns to the summary; `Start using Lumei` saves and opens Home (BR-ACC-06).
- `setup-download` signing in on a fresh device to an account that finished setup elsewhere skips setup (BR-ACC-06).

## How to get to it (user POV)

- Sign in with a new email ([Sign in](./sign-in.md)); setup opens at `Where do you live?` (`Step 1 of N`).
- Leaving setup before `Start using Lumei` and reopening the app starts it again from the first step.

## Driving it with lumei-verify

Preconditions:

- Signed in as a new user, on `Where do you live?`.
- `$V doctor` is all OK.

- **Region.** Run `$V wait --text "You'll start with"` and `$V ui --save setup-region`. `View desc="Region, United States"`, `View desc="Language, English"`, `ImageView desc="Map showing United States"`, and the ten US categories as `ViewGroup desc="☕ Coffee"` etc. show. Run `$V tap --desc "Continue" --exact`.
- **Currency.** Run `$V wait --text "Your currency"`. `USD` is selected and `You can't change the currency after setup.` shows. Run `$V tap --desc "Continue" --exact`.
- **Start day.** Run `$V wait --text "When does your period start?"`, then `$V tap --text "Skip for now"` (keeps day 1), or tap a day (`$V tap --desc "Day 25"`) and `Continue`.
- **Income.** Run `$V wait --text "Your income"`. Skip with `$V tap --text "Skip for now"`, or `$V tap --text "Add income"`, `$V tap --desc "Name"`, `$V type "Salary"`, `$V tap --desc "Amount"`, `$V type "3000"`, `$V key BACK`, `$V tap --desc "Continue" --exact`.
- **Fixed expenses.** Run `$V wait --text "Fixed expenses"` and skip or add `Rent` 1000 the same way (`Add a fixed expense`).
- **Target.** Run `$V wait --text "Your saving target"`, skip, or `$V tap --desc "Amount"`, `$V type "500"`, `$V key BACK`; `You can spend $1,500.00 this period.` shows with the numbers above. `Continue`.
- **Summary.** Run `$V wait --text "All set?"` and `$V ui --save setup-confirm`; rows for Region, Currency, Period, Income, Fixed expenses, Saving target, Spending budget. Run `$V tap --desc "Start using Lumei"`. With everything skipped, the budget is $0.00, so the first expense makes the period overspent (`Over for this period`, BR-DSH-02).
- **Home.** Run `$V wait --text "Remaining today" --timeout 30`. Home shows today's card.
- **Proof.** `$V device-sql "SELECT region, currency, period_start_day, setup_completed_at FROM settings" --save setup-device` shows `us | USD | 1 | <ms>`; after the first sync, `$V sql "SELECT region, currency, period_start_day FROM settings" --save setup-server` shows the same, and `$V sql "SELECT name, position FROM categories ORDER BY position"` the US set.

## Gotchas

- Driven on 2026-11-25 with every optional step skipped: `Step 1 of 7` to `Step 7 of 7`, `Button desc="Continue"`, `Button desc="Skip for now"`, the currency radios (`RadioButton desc="$, US dollar, USD"` selected), and the summary buttons (`Button desc="Region: United States. Change"`, `Button desc="Start using Lumei"`) are confirmed. Entering income, fixed expenses, and a target isn't driven yet.
- The target step focuses its amount field and opens the keyboard. A `Skip for now` tap then only closes the keyboard; run `$V key BACK` first.
- `Continue` is a substring of nothing else here, but `Done` replaces it while editing a step from the summary.
- The soft keyboard covers `Continue` after typing an amount; `$V key BACK` first.
- Amount fields group digits as you type (`3,000`); assert the formatted text, not the raw input.
- Setup's region step calls the API for the category sets; on a fresh stack the API must be up first, or it shows `Couldn't load the regions. Check your connection and try again.`
