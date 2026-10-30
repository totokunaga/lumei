# Business requirements

This document describes what Lumei must do for its users. Lumei is a mobile app that automates a personal budgeting spreadsheet (`Income - Expense (2026).xlsx`). Its core purpose is to answer one question every day: **"How much can I spend today and still hit my saving target?"**

- **Users:** individuals who sign up for their own account and manage only their own money.
- **Platforms:** iOS and Android (React Native), backed by the Go API (see `docs/architecture/aws-infrastructure.md`).
- **Languages:** English, Japanese, and French.
- **Currencies:** the 20 major currencies listed in [Currencies](#currencies).
- **Scope:** the first release, defined in [Scope](#scope). Requirements that come later are listed in [Future](#future).

## Background: the spreadsheet today

The workbook has one tab per saving period (e.g. `26Nov`). Each tab holds:

| Spreadsheet area | What it holds | Lumei concept |
|------------------|---------------|---------------|
| `B1` | The month the period is named after | [Saving period](#glossary) |
| `B3:C14` | Income of the period (e.g. salary) | Income |
| `B16:C39` | Fixed expenses (rent, tuition, subscriptions, utilities) and side notes | Fixed expense |
| `E3:G128` | Daily expenses: date, category, amount | Expense |
| `I3:J6` | Total income, total expense, net income | Period summary |
| `I8:J15` | Period dates, days left, saving target, available amount, average per day | Period summary, daily allowance |
| `I17:J19` | Spent today, amount left today | Today's status |
| `L3:M19` | Big purchases, kept out of the daily numbers | Big purchase |
| Chart + `I43:N75` | Daily spending (bars), cumulative spending (line), spending limit (line), today's point | Progress chart |

Habits seen across the 2026 tabs that the app must support:

- A period runs from the 25th of the previous month to the 24th of the named month (e.g. `26Nov` is Oct 25 – Nov 24), matching payday.
- Each new tab starts as a copy of the previous one: the same income and fixed expenses, with small edits (a price change, a cancelled subscription).
- The saving target changes over time (¥300,000 → ¥350,000 → ¥400,000).
- Expenses use a small set of emoji categories. By frequency: 🍔 Eat Out, 🏪 Konbini, 🚇 Suica, 🛒 Grocery, 🤩 Friends, 🏔️ Leisure, 💊 Medical, 🧴 Beauty, 👘 Fashion.
- Fixed expenses sometimes carry a note (e.g. "Tuition was originally ¥50,000").

### Known issues in the spreadsheet that the app fixes

| Issue | Spreadsheet | Lumei |
|-------|-------------|-------|
| Today's spending is subtracted twice | `J19 = (net income after all expenses incl. today − target) / days left − today's spending` | Today's spending counts once (see [BR-CALC-03](#calculations)) |
| Big purchases are spread over one day too few | `M19 = big purchases / (end − start)`, i.e. 30 days for a 31-day period | By default, spread over the days left from the purchase date. The spreadsheet's whole-period spread is an option, and it counts the period's days inclusively (see [BR-CALC-05](#calculations)). |
| Formula ranges drift between rows | `SUMIF(E6:E128, …)`, `SUMIF(E7:E129, …)`, … in the chart data | Not applicable: totals are computed from records |

## Glossary

| Term | Meaning |
|------|---------|
| **Saving period** (period) | A date range, inclusive at both ends, over which the user tries to save their saving target. Periods are consecutive, with no gaps or overlaps. |
| **Income** | Money received in a period, as named line items (e.g. "Salary"). |
| **Fixed expense** | A known cost of the period that isn't a day-to-day purchase, as named line items (e.g. "House Rent", "Netflix"). |
| **Expense** | A day-to-day purchase recorded by the user: amount, category, date and time, and optionally a description and a location. |
| **Big purchase** | An expense the user flags so it doesn't swamp the day it happened on. Its amount still counts against the period, but it is spread evenly over several days instead of hitting one day (see **Big purchase spread**). There is no rule for what counts as big. The user decides. |
| **Big purchase spread** | A user setting for which days carry a big purchase. **Days left** (the default): days from the purchase date to the end of the period. **Whole period**: every day of the period, as in the spreadsheet. |
| **Account currency** | The one currency all of a user's amounts are in. It is chosen during setup. |
| **Minor unit** | The smallest unit of a currency: 1 yen for JPY, 0.01 for the other supported currencies. |
| **Category** | A user-defined label with an emoji used to classify expenses (e.g. 🍔 Eat Out). |
| **Region** | Where the user lives, chosen during setup (Japan, the EU, or the US at launch, or "Other" for anywhere else, which uses the Global set). It decides the default categories. |
| **Default category set** | The categories a new account starts with, defined per region in seed data (see [Default category sets](#default-category-sets)). |
| **Saving target** | The amount the user wants left over at the end of a period. |
| **Spending budget** | What the user may spend on expenses in the period: income − fixed expenses − saving target. |
| **Daily allowance** | How much the user can spend today and stay on track (see [BR-CALC-03](#calculations)). |
| **Remaining today** | Daily allowance − what the user has spent today. |
| **Overspent period** | A period whose expenses so far, today's included, are more than its spending budget (see [BR-CALC-03](#calculations)). |

## Scope

**In the first release:**

- Accounts: sign-in with Apple or Google, sign-out, account deletion
- Settings: language, region, account currency, period start day, big purchase spread
- Saving periods, income, fixed expenses, and the saving target
- Expense recording, including big purchases and optional location
- Today's status and the progress chart
- Expense history, past periods, and trends
- Custom categories
- Offline expense recording with later sync

**Out of the first release:** see [Future](#future).

## Functional requirements

Requirement IDs are stable. Refer to them from designs, tickets, and tests, and never reuse an ID. **Must** requirements are needed for the first release. **Should** requirements are wanted in it, but can slip to a later release.

### Accounts

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-ACC-01 | Must | A person signs in with **Sign in with Apple** or **Sign in with Google**, on both iOS and Android. The first sign-in creates the account. There is no email and password sign-in. |
| BR-ACC-02 | Must | A signed-in user sees and changes only their own data. No user can read or change another user's data. |
| BR-ACC-03 | Must | A user stays signed in across app restarts until they sign out or the session expires. |
| BR-ACC-04 | Must | A user can sign out. |
| BR-ACC-05 | Must | A user can delete their account. Deletion permanently removes all of their data, including location history. It also revokes the app's access to every Apple and Google sign-in used for the account. |
| BR-ACC-06 | Must | A new user goes through a short setup before reaching the home screen. They choose the region (BR-SET-06) and the account currency, then set the period start day, enter income and fixed expenses, and set a saving target. The region and currency steps can't be skipped. Every other step can be skipped and finished later. |
| BR-ACC-07 | Must | Lumei identifies a user by their email address. If an Apple or Google sign-in has the same email address as an existing account, it opens that account instead of creating a new one. The user can then sign in to the account with either provider. Only email addresses the provider reports as verified are matched. |
| BR-ACC-08 | Must | A sign-in with a different email address creates a separate account. This includes an Apple sign-in that uses "Hide My Email". |

### Saving periods

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-PER-01 | Must | A user can set the **period start day**: the day of the month a period starts. Each period ends on the day before the next start day. The default is **1**, which gives calendar months. Start day 25 gives Oct 25 – Nov 24, as in the spreadsheet. |
| BR-PER-02 | Must | If the start day doesn't exist in a month (e.g. 31 in February), the period starts on the last day of that month. |
| BR-PER-03 | Must | A new period is created automatically when the previous one ends. It copies the income, fixed expenses, and saving target of the previous period. The user can then edit any of them for the new period. |
| BR-PER-04 | Should | A user can change the start or end date of a single period (e.g. payday moved earlier because the 25th is a holiday). The neighbouring period's dates move with it, so periods never overlap or leave gaps. A change that would leave a period with no days, or that would leave an expense outside every period, is rejected. |
| BR-PER-05 | Must | Changing the period start day affects only periods that haven't started yet. Current and past periods keep their dates. |
| BR-PER-06 | Must | A period is labelled by the month of its end date, plus its date range when it isn't a calendar month. E.g. "November 2026" for start day 1, and "November 2026 (Oct 25 – Nov 24)" for start day 25, matching the tab names in the spreadsheet. |
| BR-PER-07 | Must | Periods are independent: money saved or overspent in one period does not carry over to the next. |

### Saving target

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-TGT-01 | Must | A user can set the saving target of the current period and of future periods. |
| BR-TGT-02 | Must | Changing the target updates the daily allowance and the chart immediately. |
| BR-TGT-03 | Should | The app warns the user when the target is greater than income − fixed expenses, since no spending could meet it. The app still accepts the target. |

### Income and fixed expenses

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-INC-01 | Must | A user can add, edit, and delete income items of a period. Each item has a name and an amount (e.g. "Salary", ¥640,808). A period can have any number of items. |
| BR-INC-02 | Must | A user can add, edit, and delete fixed expense items of a period. Each item has a name, an amount, and an optional note (e.g. "Originally ¥50,000"). |
| BR-INC-03 | Must | Edits apply to the selected period only. Earlier and later periods keep their own items. A period created after the edit copies the edited items (BR-PER-03). |
| BR-INC-04 | Must | An amount of 0 is allowed. It keeps an item visible for a month in which it isn't charged (e.g. "House Rent", ¥0). |
| BR-INC-05 | Should | A user can reorder income and fixed expense items. |

### Expenses

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-EXP-01 | Must | A user can record an expense by entering only an **amount** and a **category**. Every other field is optional. |
| BR-EXP-02 | Must | The date and time default to the moment of entry. The user can change them to an earlier date and time, but not to a later one. |
| BR-EXP-03 | Must | A user can add an optional description. |
| BR-EXP-04 | Must | When the user allows location access, a new expense captures the device's GPS location automatically. The user can move it on a map or remove it before or after saving. Without permission, expenses are recorded without a location and the app keeps working. |
| BR-EXP-05 | Must | A user can mark an expense as a **big purchase** when recording it or later, and can remove the mark later. |
| BR-EXP-06 | Must | A user can edit every field of an expense, and can delete an expense. Deleting asks for confirmation or offers undo. |
| BR-EXP-07 | Must | An expense belongs to the period that contains its date. Changing the date can move it to another period. |
| BR-EXP-08 | Must | The amount is in the account currency and greater than 0. It has at most as many decimals as the currency's minor unit allows (none for JPY, two for the others). Income, fixed expenses, and the saving target follow the same decimal rule, but they can also be 0 (BR-INC-04). Refunds and negative amounts aren't supported in the first release (see [Future](#future)). |
| BR-EXP-09 | Must | Recording an expense takes no more than 3 taps after opening the app: amount, category, save. The home screen offers expense entry directly. |
| BR-EXP-10 | Must | A user can list the expenses of a period, grouped by day with a total for each day. The user can filter the list by category and see big purchases separately. |
| BR-EXP-11 | Should | A user can search expenses by description. |

### Categories

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-CAT-01 | Must | A new account starts with the [default category set](#default-category-sets) of its region (BR-SET-06). A user whose region has no set of its own gets the Global set. |
| BR-CAT-02 | Must | A user can add a category with a name and an emoji, rename it, change its emoji, and reorder categories. The order is the order shown when recording an expense. |
| BR-CAT-03 | Must | A user can archive a category. An archived category isn't offered for new expenses, but past expenses keep it and still appear under it in history and trends. A user can unarchive a category. |
| BR-CAT-04 | Must | Category names are unique per user, among active and archived categories alike. |
| BR-CAT-05 | Should | A category can be deleted only if no expense uses it. Otherwise, the app offers to archive it instead. |
| BR-CAT-06 | Must | The default categories are named in the app language chosen at setup. Changing the language later doesn't rename categories. |
| BR-CAT-07 | Must | Default category sets are defined in seed data, not in the app's code. The seed data gives each category its emoji and its name in every supported language. Adding a region or editing a set needs no app update. A change applies only to accounts set up after it. Existing users' categories never change. |

### Default category sets

Initial seed data for the launch regions: Japan, the EU, and the United States. The Global set is for users in any other region. A region's set is complete on its own: it isn't added on top of the Global set. Names are shown in English; the seed data also has Japanese and French names.

| Region | Categories, in display order |
|--------|------------------------------|
| Global | 🍔 Eat Out, 🛒 Grocery, 🚌 Transport, 🤩 Friends, 🏔️ Leisure, 💊 Medical, 🧴 Beauty, 👕 Fashion |
| Japan | 🍔 Eat Out, 🏪 Konbini, 🚇 Suica, 🛒 Grocery, 🤩 Friends, 🏔️ Leisure, 💊 Medical, 🧴 Beauty, 👘 Fashion (the spreadsheet's categories) |
| EU | 🍔 Eat Out, 🥖 Bakery, 🛒 Grocery, 🚌 Transport, 🤩 Friends, 🏔️ Leisure, 💊 Pharmacy, 🧴 Beauty, 👕 Fashion |
| United States | 🍔 Eat Out, ☕ Coffee, 🛒 Grocery, ⛽ Gas, 🚌 Transit, 🤩 Friends, 🏔️ Leisure, 💊 Medical, 🧴 Beauty, 👕 Fashion |

### Settings

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-SET-01 | Must | The app is available in **English, Japanese, and French**. On first launch it uses the device language if it is one of these, and English otherwise. A user can change the language at any time in the app's settings. |
| BR-SET-02 | Must | Dates, numbers, and currency amounts are formatted for the app language, e.g. "¥4,865" in English, "￥4,865" in Japanese, and "4 865 ¥" in French. |
| BR-SET-03 | Must | During setup, a user chooses the **account currency** from the [supported currencies](#currencies). The device region's currency is suggested when it is supported. Otherwise, USD is suggested. |
| BR-SET-04 | Must | The account currency can't be changed after setup in the first release, and amounts are never converted between currencies. The app shows this before setup is confirmed. |
| BR-SET-05 | Must | A user can choose the **big purchase spread**: **Days left** (the default) or **Whole period**. The one setting applies to all of the user's big purchases. Changing it updates the current and past periods' charts. Daily allowances and period results don't change (see [Calculations](#calculations)). |
| BR-SET-06 | Must | During setup, the app asks which **region** the user lives in. It preselects the region detected from the device's region setting (any EU member state maps to EU), not from GPS, since location permission may not be granted yet. The choices are every region with its own [default category set](#default-category-sets), plus "Other", which uses the Global set. |
| BR-SET-07 | Should | A user can change the region later in settings. The app then offers to add the new region's default categories that the user doesn't already have. Existing categories and expenses aren't changed. |

### Currencies

The supported currencies are the major currencies listed by [OANDA](https://www.oanda.com/currency-converter/en/currencies/majors/):

| Code | Currency | Minor unit |
|------|----------|------------|
| AED | UAE dirham | 0.01 |
| AUD | Australian dollar | 0.01 |
| BRL | Brazilian real | 0.01 |
| CAD | Canadian dollar | 0.01 |
| CHF | Swiss franc | 0.01 |
| CNY | Chinese yuan renminbi | 0.01 |
| EUR | Euro | 0.01 |
| GBP | British pound | 0.01 |
| HKD | Hong Kong dollar | 0.01 |
| INR | Indian rupee | 0.01 |
| JPY | Japanese yen | 1 |
| MXN | Mexican peso | 0.01 |
| MYR | Malaysian ringgit | 0.01 |
| PHP | Philippine peso | 0.01 |
| SAR | Saudi riyal | 0.01 |
| SEK | Swedish krona | 0.01 |
| SGD | Singapore dollar | 0.01 |
| THB | Thai baht | 0.01 |
| USD | US dollar | 0.01 |
| ZAR | South African rand | 0.01 |

### Today's status (home screen)

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-DSH-01 | Must | The home screen shows, for today: the **daily allowance**, **spent today**, and **remaining today** (BR-CALC-03, BR-CALC-04). Remaining today is the most prominent number, except while the period is overspent (BR-DSH-02). |
| BR-DSH-02 | Must | When remaining today is negative, the app shows it as an overspend (e.g. "¥1,200 over") rather than a negative number. When the period is **overspent** (BR-CALC-03), the daily allowance shows 0, and by how much the period is over (e.g. "¥2,000 over for this period") replaces remaining today as the most prominent number. This happens as soon as the expense that takes the period over is saved. |
| BR-DSH-03 | Must | The home screen shows a period summary: total income, total fixed expenses, total big purchases, total spending to date, saving target, spending budget left, and days left. |
| BR-DSH-04 | Must | All numbers update as soon as an expense, income, fixed expense, or target changes. This includes changes made offline. |
| BR-DSH-05 | Must | "Today" is the current date in the device's time zone. A day rolls over at local midnight. |

### Progress chart

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-CHT-01 | Must | A chart shows each day of the selected period with: a **bar** for that day's spending (BR-CALC-05), a **line** for cumulative spending, a **line** for the spending limit (BR-CALC-06), and a **marker** for today's cumulative spending. |
| BR-CHT-02 | Must | The chart shows how far the user is from the limit today, e.g. "¥8,400 under the limit" or "¥3,000 over the limit". |
| BR-CHT-03 | Must | Bars and lines stop at today. Future days show only the limit line. |
| BR-CHT-04 | Should | Tapping a day shows that day's spending, its cumulative spending, and its limit, and opens that day's expenses. |
| BR-CHT-05 | Must | The chart is readable in both light and dark mode, and doesn't rely on color alone to tell the series apart. |

### History and trends

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-HIS-01 | Must | A user can browse past periods. For each one, they see its summary, chart, and expenses as they stood at the end of the period. |
| BR-HIS-02 | Must | Each past period shows its result: amount saved (BR-CALC-07), the target, and whether the target was met. |
| BR-HIS-03 | Must | A user can edit or add expenses, income, and fixed expenses in a past period (e.g. a late entry). The period's results are recalculated after the change. |
| BR-HIS-04 | Must | A user can see spending by category for any period, as amounts and as shares of total spending. |
| BR-HIS-05 | Should | A user can see trends across periods: amount saved vs. target per period, and spending per category per period. |

### Offline use

| ID | Priority | Requirement |
|----|----------|-------------|
| BR-OFF-01 | Must | A user can record, edit, and delete expenses without a network connection. |
| BR-OFF-02 | Must | Today's status and the chart for the current period work offline. They reflect the changes the user made offline. |
| BR-OFF-03 | Must | Offline changes sync automatically once the device is back online, without the user doing anything. A change is never lost or applied twice. |
| BR-OFF-04 | Must | The app shows which changes haven't synced yet. |
| BR-OFF-05 | Must | If the same expense was changed on two devices, the change saved most recently wins. Deleting an expense wins over editing it. |
| BR-OFF-06 | Should | Changing income, fixed expenses, the target, periods, and categories works offline too. If this isn't ready in time, these screens may require a connection in the first release. They must then say so clearly. |

## Calculations

All amounts are in the account currency. All dates are calendar dates in the user's time zone. Ranges include both ends.

| ID | Name | Definition |
|----|------|------------|
| BR-CALC-01 | Period length and days left | `period days = end − start + 1`. `days left = end − today + 1` (today counts) while today is in the period. |
| BR-CALC-02 | Spending budget | `budget = Σ income − Σ fixed expenses − saving target` |
| BR-CALC-03 | Daily allowance | `allowance = floor((budget − Σ big purchases in the period − Σ other expenses dated before today) / days left)`, rounded down to the currency's minor unit so it never overstates what can be spent. It is fixed for the day: today's own expenses don't change it. The period is **overspent** when `Σ all expenses in the period`, today's and big purchases included, is greater than the budget. Then the allowance is 0 and `period overspend = Σ all expenses in the period − budget` (BR-DSH-02). |
| BR-CALC-04 | Spent and remaining today | `spent today = Σ expenses dated today, excluding big purchases`. `remaining today = allowance − spent today`. Not shown while the period is overspent (BR-DSH-02), since today's numbers lose their meaning once the whole budget is gone. |
| BR-CALC-05 | Daily spending (chart bars) | `daily spending(d) = Σ expenses dated d, excluding big purchases + Σ share(b, d) over the period's big purchases b`. The share depends on the big purchase spread (BR-SET-05). **Days left:** `share(b, d) = amount(b) / (end − date(b) + 1)` on each day from the purchase date to the end of the period, and 0 before it. **Whole period:** `share(b, d) = amount(b) / period days` on every day of the period. |
| BR-CALC-06 | Spending limit (chart line) | `limit(d) = budget × n / period days`, where `n` is the day number of `d` in the period (1 for the start date). On the last day, the limit equals the budget, so ending at or under the line means the target was met. |
| BR-CALC-07 | Amount saved (period result) | `saved = Σ income − Σ fixed expenses − Σ all expenses in the period, big purchases included`. The target is met when `saved ≥ saving target`. |

Notes on the definitions:

- A big purchase reduces the allowance of every remaining day equally. It never counts toward "spent today".
- The big purchase spread changes only the chart: which days' bars carry each big purchase, and so the cumulative line and today's distance from the limit. The daily allowance and the period result are the same under both options. Expenses can't be dated in the future (BR-EXP-02), so every big purchase in the allowance has already happened. The part of it that earlier days don't already carry is spread over today and the days left either way.
- An expense recorded for an earlier date doesn't change "spent today". It lowers the allowance from today onward.
- Today's expenses never lower today's allowance; they lower remaining today. Taking them out of both would count them twice, which is the spreadsheet's bug. They do count toward whether the period is overspent, so the allowance drops to 0 the moment the budget runs out.
- The daily allowance is the only value that is rounded. A big purchase share can include a fraction of the minor unit. The chart keeps it exact and rounds it only for display.

### Worked example (`26Nov` on Oct 29, 2026)

The spreadsheet's numbers, with the period start day set to 25 and JPY as the account currency:

| Input | Value |
|-------|-------|
| Period | Oct 25 – Nov 24 (31 days). 27 days left, today included. |
| Income | ¥640,808 |
| Fixed expenses | ¥70,577 |
| Saving target | ¥400,000 |
| Big purchases | ¥28,000 (🏔️ Leisure) |
| Expenses Oct 25–28 | ¥10,870 |
| Expenses today (Oct 29) | ¥4,137 |

- Budget = 640,808 − 70,577 − 400,000 = **¥170,231**
- Daily allowance = floor((170,231 − 28,000 − 10,870) / 27) = floor(131,361 / 27) = **¥4,865**, under either big purchase spread
- Remaining today = 4,865 − 4,137 = **¥728**

For comparison, the spreadsheet shows ¥575 for remaining today, because it subtracts today's ¥4,137 twice.

## Non-functional requirements

| ID | Area | Requirement |
|----|------|-------------|
| BR-NFR-01 | Privacy | Location is collected only with the user's permission and only when an expense is recorded, never in the background. |
| BR-NFR-02 | Privacy | Financial and location data is never shared with third parties or used for advertising. |
| BR-NFR-03 | Security | All traffic is encrypted in transit and all data is encrypted at rest. The app never handles passwords: Apple and Google handle sign-in. |
| BR-NFR-04 | Performance | Saving an expense updates the home screen within 1 second, online or offline. |
| BR-NFR-05 | Availability | If the API is unreachable, the app falls back to offline mode (BR-OFF-01 to BR-OFF-04). It doesn't block the user. |
| BR-NFR-06 | Correctness | Amounts are stored and calculated as integers in the currency's minor unit (e.g. cents for USD), never as floating-point values. |
| BR-NFR-07 | Accessibility | Supports the OS font-size setting and screen readers. Every number on the home screen and chart has a text equivalent. |
| BR-NFR-08 | Localization | Every user-facing text, including errors and notifications, is available in English, Japanese, and French. |

## Assumptions

Items not yet decided. When one is decided, update this document and remove its row.

None at the moment. Add new rows as `| Item | Assumption |`.

## Future

Requirements recognised but out of the first release:

- Import of the existing Excel workbook (`Income - Expense (2026).xlsx`).
- Carrying leftover or overspent money into the next period.
- Shared budgets between users (e.g. a household).
- Refunds and negative expenses.
- **Currency conversion:**
  - recording an expense in a currency other than the account currency (e.g. while travelling), converted into the account currency
  - changing the account currency, with existing amounts converted
- **Future-dated expenses,** e.g. recording a planned purchase ahead of time. This needs the daily allowance and big purchase spread rules revisited, because [Calculations](#calculations) assumes every expense has already happened.
- Linking sign-ins whose email addresses differ to one account (e.g. an Apple sign-in using "Hide My Email").
- Choosing the big purchase spread per purchase.
- Languages other than English, Japanese, and French.
- Receipt photos attached to expenses.
- Reminders, e.g. "You haven't recorded anything today", or an alert when remaining today goes negative.
- Home screen widgets showing remaining today.
- Data export (CSV).
- Bank and card integration for automatic expense import.
- Showing expenses on a map, using the recorded locations.
