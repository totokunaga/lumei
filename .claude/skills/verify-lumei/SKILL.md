---
name: verify-lumei
description: Launch and drive the Lumei mobile app (Expo React Native) on a private Android emulator against an isolated local Go API and Postgres, the way a user does, and capture proof (screenshots, UI trees, on-device SQLite rows, server Postgres rows). Use to confirm a Lumei feature or fix works in the real app, not only in Jest or Go tests, e.g. sign-in, setup, recording an expense, home numbers, categories, sync, sign-out.
---

# Verify Lumei

Drives the real app on a private Android emulator with `adb` + `uiautomator`, against a throwaway API and database, and records evidence. Everything goes through one helper:

```sh
V=/Users/tomoya.tokunaga/dev/totokunaga/lumei/.claude/skills/verify-lumei/lumei-verify   # <repo>/.claude/skills/verify-lumei/lumei-verify
$V help
```

Read [features/README.md](features/README.md) next, then the feature file for what you are verifying. [Record an expense](features/record-expense.md) is the journey this skill was proved with.

## What runs, and what is local-only

| Part | How | Where |
|------|-----|-------|
| Postgres 17 | `docker run --rm --tmpfs`, container `lumei-verify-pg-<run-id>`, label `lumei-verify=<run-id>` | `127.0.0.1:18091` |
| Go API | `go run ./cmd/migrate up`, then `go build ./cmd` into scratch, run on the host | `:18090` |
| Metro | `bunx expo start --port 18092` in `frontend/`, with `EXPO_PUBLIC_API_URL=http://localhost:18090` and `TMPDIR=~/.cache/lumei-verify/metro-tmp` | `:18092` |
| Emulator | AVD `lumei-verify`, created once in `~/.cache/lumei-verify/avd/` from the newest arm64 system image, booted headless with `-wipe-data -no-snapshot -port 5584` | adb serial `emulator-5584` |
| App | the existing debug APK `frontend/android/app/build/outputs/apk/debug/app-debug.apk`; `adb reverse tcp:18092` and `tcp:18090`; the app's `debug_http_host` set to `localhost:18092` | package `com.anonymous.lumei` |

**Local-only settings.** The API runs with `APP_ENV=development` and `AUTH_DEV_SIGN_IN=true`. That is what makes the sign-in screen's "Development only: sign in as any email" box work (the box shows only in `__DEV__` builds). `Config.Validate` refuses both in production. They, and Expo Go's `host.exp.Exponent` Apple client ID, are for local development only. Never enable them in a deployed environment, an EAS environment, or any `.env` file that leaves this Mac. The JWT signing key and token-encryption key are generated for each run by `openssl` and live only in the API process's environment. They are dev-only and never written to disk. This skill never reads `backend/.env.dev` or `.env.keys`. Don't add that.

**Why Android, not iOS.** This Mac has Xcode and `simctl`, which can install, screenshot, and open URLs, but nothing that can tap an iOS simulator. There is no Maestro, no idb, and no XCUITest target, and one can't be added because `frontend/ios/` is generated. Android's `adb` + `uiautomator` reads the accessibility tree and taps, so it is the drive path. iOS-only behavior is **not verified by this skill**: Liquid Glass, Sign in with Apple, the Add Expense shortcut (BR-EXP-12), and Apple Maps. Say so in your report rather than claiming it. Installing Maestro (`brew install maestro`, or its install script) would make iOS drivable; it isn't part of the repo's tooling, so ask the user first.

**Why the user's things are safe.** The user's `lumei-api`/`lumei-postgres` containers (18080/15432), their Metro on 8081, and their AVDs are never used. The app is pointed away from 8081 because an emulator's debug app otherwise loads `10.0.2.2:8081`, which is the user's Metro.

## Launch

```sh
$V up              # headless; add --window to watch; --avd NAME to boot an existing AVD read-only instead
```

`up` refuses to start, rather than double-driving, if any of ports 18090, 18091, 18092, 5584, or 5585 is taken, if `emulator-5584` exists, or if a stack is already recorded. Then it does these steps in order:

1. Starts Postgres and waits for `pg_isready` over TCP, which passes only after the image's init scripts finish.
2. Applies every migration and checks that the `category_sets` seed rows exist.
3. Builds and starts the API, and waits for `GET /health/full` to return 200.
4. Cold-boots a wiped emulator (1-3 min) and waits for `sys.boot_completed=1`. It refuses an AVD that is still locked by a PIN or pattern.
5. Installs the APK, sets up the two `adb reverse` ports, and writes `debug_http_host`.
6. Starts Metro, clearing only its own cache when the inlined `EXPO_PUBLIC_API_URL` changed, and waits for `/status`.
7. Launches the app, retrying while the package manager catches up. It denies the system "nearby devices" prompt the debug build raises at first launch, and waits until the sign-in, setup, or home screen is actually drawn.

It ends with `READY. Evidence dir: …`. The whole launch takes about 4-6 minutes.

Every launch has an empty database (seed data only) and a fresh device, so start every journey at sign-in.

Rebuild the APK first if it is missing, or if the change touches native code: `app.json`, config plugins, a new native dependency, or `modules/`. Run `cd frontend && bunx expo run:android`. It writes only build output into the generated `android/`; never hand-edit `android/` or `ios/`. `expo run:android` starts its own Metro on 8081 and installs on whatever device is attached, so run it before `up`, stop it with Ctrl-C once the APK is built, and keep in mind that the user's own Metro may already hold 8081. JS-only changes need no rebuild, because Metro serves the working tree.

## Doctor

```sh
$V doctor
```

Doctor is read-only. It prints `OK` or `FAIL` for each check and exits 1 if any check fails. It checks that:

- every recorded PID is alive
- the container is running with this run's label
- port 18090 belongs to our API PID, and `/health/full` returns 200
- Metro is running
- `emulator-5584` is attached and running the recorded AVD
- the app's `debug_http_host` is our Metro
- both reverse ports are in place
- the app is installed and its process is running

Run it first whenever anything looks off. If it fails, run `$V down` and then `$V up` rather than patching a half-broken stack.

## Drive

Read the screen, then act on stable handles: the visible English text (`text=`) or the accessibility label (`desc=`, React Native's `accessibilityLabel`). Buttons expose their label as `desc=` on a `Button` node, with the text in a child `TextView`. The app has almost no `testID`s, so take strings from `frontend/src/i18n/locales/en.json`; the emulator is English (United States). Fall back to coordinates only for gestures.

```sh
$V ui                                   # on-screen nodes: class text= desc= id= [flags] bounds
$V ui --save exp-01-home-before         # same, saved as evidence (.ui.txt + .ui.xml)
$V tap --desc "Add expense"             # substring of accessibilityLabel; waits up to 15 s for it
$V tap --desc "Save" --exact            # whole-string match
$V tap --any "Grocery" --index 1        # text or desc, second match
$V tap --id "permission_deny_button"    # resource-id substring (system dialogs, "chart-plot")
$V wait --text "Remaining today" --timeout 30
$V gone --text "New expense"
$V tap --desc "Email address" && $V type "verify@example.com"   # focus, then type
$V key BACK                              # closes the soft keyboard (or goes back if none is open)
$V swipe 1100 900 200 900 300            # x1 y1 x2 y2 ms, pixels on the 1280x2856 screen
$V shot exp-04-home-after                # screenshot to evidence
$V sql "SELECT amount FROM expenses" --save exp-06-server
$V device-sql "SELECT amount, pending FROM expenses" --save exp-05-device
$V note "exp-quick-add (BR-EXP-01, BR-EXP-09): …"
```

Flags in `ui` output: `C` clickable, `x` checked, `s` selected, `F` focused, `-` disabled. After a tap that opens a sheet or a new screen, `wait` for something on it before the next tap. Only one `uiautomator dump` can run at a time: don't run two helper commands at once, because the second one gets `Killed`.

Deep links reach a screen quickly (`adb -s emulator-5584 shell am start -a android.intent.action.VIEW -d lumei:///settings/categories`). A proof of a user journey still has to use taps from the screen a user would start on.

## Evidence

Evidence goes in `~/.cache/lumei-verify/evidence/<run-id>/`. `up` and `doctor` print the path, and the evidence survives `down`. It holds:

- `build.txt`: HEAD, the number of uncommitted entries, the diff stat of the sync files, and the APK's date
- everything saved with `shot`, `ui --save`, `sql --save`, and `device-sql --save`
- `steps.md`, written by `note`
- after `down`, the `api`, `metro`, `emulator`, and `migrate` logs

Proof standards:

- Drive the real user path: taps on the screens a user sees, starting from sign-in on a fresh install. Never call the sync endpoints, insert rows, or use deep links in place of the step being proved.
- Capture the action and the result, with `shot` and `ui --save` both before the decisive tap and after it, not just the final screen.
- Verify side effects as well as the screen: the row in the device's SQLite (`device-sql`: written, `pending`), and, where sync is part of the feature, the same row in the server's Postgres (`sql`), joined to the user's email.
- Cite the BR IDs the journey covers in `note` lines and in your report.
- Nothing is mocked: the API, database, and app are real. The stand-ins are the dev sign-in (for Apple/Google) and the emulator (for a phone). Apple/Google sign-in, revoking them on account deletion (BR-ACC-05), multi-device behavior, and anything iOS-only stay unverified. List them as such.
- If a journey can't reach its end state, report it as failed, with the step and the reason. Don't weaken the journey to make it pass.

## Cleanup

```sh
$V down
```

`down` stops what this run started, using the recorded PIDs and process groups only: the emulator, Metro and its children, and the API. It removes the `lumei-verify-pg-<run-id>` container, copies the logs into the evidence dir, and deletes the scratch files in `~/.cache/lumei-verify/run/`. It never kills by name and never sends `adb emu` commands. Afterwards it compares the other emulators and containers with what was running before, and warns if any of them disappeared. If that happens, tell the user; don't restart their things yourself.

Some things are kept on purpose:

- `~/.cache/lumei-verify/metro-tmp/` is Metro's cache, so the next bundle is faster.
- `~/.cache/lumei-verify/avd/` is the private AVD, wiped at every boot, a few GB.

The user can delete either one when they no longer want this skill. Run `down` after every failed attempt too, then confirm the evidence dir still exists.

## Gotchas

- **Another agent's sync edits.** Another agent may briefly edit `frontend/src/sync/` or `backend/internal/application/sync.go`. Metro serves whatever is on disk, and `up` builds the API from it. If sync misbehaves oddly, run `git diff` on those files and compare it with `build.txt` before concluding anything. `sync.go` also carries the user's own uncommitted work, so a non-empty diff there is normal.
- **Fixed ports, one run at a time.** Metro compiles the API URL into the bundle, so the ports are fixed and two verification runs can't share a Mac.
- **Local network permission.** Android 16+ blocks an app's access to private addresses (`10.0.2.2`) unless it has the "nearby devices" permission, which `up` denies. That is why everything goes through `localhost` and `adb reverse`. Don't switch back to `10.0.2.2`.
- **The user's AVDs have screen locks.** `--avd Pixel_10_Pro` boots to a pattern lock, and the app can't start while the user is locked; `up` refuses it. Use the default AVD.
- **LogBox.** The debug build shows a yellow "Open debugger to view warnings." bar at the bottom of the sign-in screen, over the `Sign in` button. Tap its close box (the small clickable `ViewGroup` at its right end, about `1238 2638`) before tapping `Sign in`.
- **Soft keyboard.** After typing, the keyboard covers the bottom buttons, and the first tap may only close it. Run `$V key BACK` first, but only while a field is focused (`F`), or BACK navigates back.
- **Location prompt.** The first `Add expense` asks for location (BR-EXP-04). Deny it with `$V tap --id "permission_deny_button"` unless the journey is about location.

## Maintenance

The feature map is the maintained source of what to verify. Keep it honest as the app changes with `/pstack:maintain-verification-skill`.
