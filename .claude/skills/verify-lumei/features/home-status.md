# Today's status

The home screen answers "how much can I spend today?": three swipeable cards (Today, This week, This period) with the daily allowance, spent and remaining amounts, a ring, the period summary, the progress chart with its spending-by-category card, and the period's expenses with filter chips.

## Sub-features

- `dsh-today` shows Remaining today (most prominent), Daily allowance, Spent today, and the ring with its share (BR-DSH-01, BR-CALC-03, BR-CALC-04).
- `dsh-overspent` shows `Over for this period` with a negative amount once expenses exceed the budget (BR-DSH-02).
- `dsh-cards` swipes between Today, This week (`Remaining this week (N days)`), and This period (`Remaining this period (N days)`) (BR-DSH-07, BR-CALC-10).
- `dsh-summary` expands the period card to Planned income, Fixed expenses, Big purchases, Spent so far, Saving target, Budget left, Days left (BR-DSH-03, BR-CALC-08).
- `dsh-chart` shows the chart with a whole-period / last-5-days switch and the distance from today's spending limit (BR-CHT-01 to BR-CHT-06).
- `dsh-categories` swipes from the chart to spending by category; tapping one filters the list (BR-HIS-04, BR-CALC-09).
- `dsh-filters` filter chips: All, each used category, Big purchases (BR-EXP-10).
- `dsh-live` every number changes right after a save, offline too (BR-DSH-04, BR-NFR-04).

## How to get to it (user POV)

- The Home tab, the first screen after sign-in once setup is finished.
- Swipe the top card left and right; tap the period card to expand it.
- Swipe the chart card left for spending by category.

## Driving it with lumei-verify

Preconditions:

- Signed in and setup finished with known numbers so the allowance is predictable: in [Setup](./setup.md), income `Salary` 3000, fixed expense `Rent` 1000, saving target 500 (USD), so the budget is 1,500.00.
- `$V doctor` is all OK.

- **Today.** On Home, run `$V wait --text "Remaining today"` and `$V ui --save dsh-today`. The allowance is `floor(1500.00 / days left)` to the cent (BR-CALC-03; days left from `Remaining this period (N days)`), and Spent today is $0.00.
- **Live update.** Record an expense of 12.50 ([Record an expense](./record-expense.md)). Within a second `Spent today` reads $12.50 and `Remaining today` drops by 12.50; the allowance is unchanged.
- **Cards.** Swipe the card left twice: `$V swipe 1100 900 200 900 300` each time, then `$V wait --text "Remaining this week"` and `$V wait --text "Remaining this period"`.
- **Summary.** Tap the period card (`$V tap --desc "Period details"`). The summary rows show income $3,000.00, fixed $1,000.00, target $500.00, spent $12.50, budget left $1,487.50.
- **Chart.** `$V wait --id "chart-plot"`; `$V ui` shows its text summary (`… under today's spending limit`).
- **Overspent.** Record 2,000.00 as one expense. `Over for this period` shows `-$512.50`, and the allowance shows $0.00 (BR-DSH-02).
- **Proof.** `shot` and `ui --save` after each step; the expected values above are the assertions.

## Gotchas

- Not yet driven end to end by this skill: the handles come from `en.json` and the screen code. Fix any that differ on the first run and note it here.
- Skia draws the chart, so bars and lines aren't in the UI tree; assert the chart through its accessibility summary text, and use `shot` for the picture.
- Numbers count up to their new value; `wait` for the final text rather than reading the first dump after a save.
- Days left depend on today's date and the start day; compute expected values from the `Remaining this period (N days)` label, not a hard-coded number.
- Card swipe coordinates assume the 1280x2856 Pixel 10 Pro screen; read the card's bounds from `ui` on another AVD.
