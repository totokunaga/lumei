# Lumei verification map

This directory is the maintained source for verifying Lumei's user-facing behavior on the Android emulator. Read this index before driving the app, then use the matching feature file as the recipe. Requirement IDs refer to `docs/requirements/business-requirements.md`, which wins over this map when they disagree; fix the map in the same change.

## Baseline preconditions

- `$V` is `<repo>/.claude/skills/verify-lumei/lumei-verify`.
- `$V up` finished with `READY`, and `$V doctor` prints only `OK` lines.
- The stack is fresh: empty Postgres (seed data only), fresh emulator data, app on the sign-in screen. Every `up` gives that.
- The emulator's language and region are English (United States), so setup suggests United States and USD, and every handle below is the English string from `frontend/src/i18n/locales/en.json`.
- The first `Add expense` raises Android's location prompt; deny it (`$V tap --id "permission_deny_button"`) unless the journey is about location.
- Never drive an emulator, API, or database this run didn't start (`doctor` checks ownership).

## Driving conventions

- Start each recipe from the state its `Preconditions:` names. Most need [Sign in](./sign-in.md) and [Setup](./setup.md) first; run those as the opening of the journey, never by writing rows directly.
- Find controls by visible text (`--text`) or accessibility label (`--desc`). Use `--exact` when a string is a prefix of another (`Sign in` vs `Sign in with Google`).
- `wait` for an element of the next screen after every navigation before tapping again.
- Treat commands as literal; keep quoted strings unchanged, including typographic characters (`…`, `’`).
- Mutations stay in the throwaway database; `down` discards them. There is no fixture to restore.

## Proof and skip reporting

- Capture the action and the result: `shot` and `ui --save` before the decisive tap and after it.
- Mutation proof includes a second, read-only view: the row on the device (`device-sql`) and, for synced data, on the server (`sql`).
- Record the feature, sub-feature ID, entry point, and BR IDs with `note` for each artifact.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report a skipped entry point as verified through another one.
- iOS-only paths (Sign in with Apple, Liquid Glass chrome, Apple Maps, the Add Expense shortcut BR-EXP-12) can't be driven on this Mac: no tool can tap an iOS simulator. Report them as unverified. Google sign-in and Apple's Android web flow need real OAuth clients and an HTTPS API, so they are unverified too; the dev email sign-in stands in for them.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line each and the BR IDs it covers.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with lumei-verify` starts with `Preconditions:` and uses labeled bullets pairing each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Sign in](./sign-in.md) covers the development email sign-in, staying signed in across a restart, and errors (BR-ACC-01, BR-ACC-03, BR-ACC-07).
- [Setup](./setup.md) covers the first-run flow: region, currency, start day, income, fixed expenses, target, and the summary (BR-ACC-06, BR-SET-03, BR-SET-06, BR-CAT-01).
- [Record an expense](./record-expense.md) (proved end to end on 2026-11-25) covers the quick-add path from the home screen, the on-device write, and its sync to the server (BR-EXP-01, BR-EXP-08, BR-EXP-09, BR-DSH-04, BR-DSH-06, BR-OFF-03, BR-OFF-04).
- [Today's status](./home-status.md) covers the home screen's cards, summary, chart, and filters (BR-DSH-01 to BR-DSH-07, BR-CALC-03, BR-CHT-01 to BR-CHT-06, BR-EXP-10, BR-HIS-04).
- [Categories](./categories.md) covers adding, renaming, archiving, and deleting categories in Settings (BR-CAT-02 to BR-CAT-05).
- [Account](./account.md) covers sync status, sign-out, and account deletion in Settings (BR-ACC-04, BR-ACC-05, BR-OFF-04).
