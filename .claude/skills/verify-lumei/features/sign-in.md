# Sign in

Sign in creates or opens the user's account and keeps them signed in across restarts. On this Mac it is driven through the development-only email sign-in, which stands in for Sign in with Apple and Google and works only against the local API started by `lumei-verify up` (`AUTH_DEV_SIGN_IN=true`, local-only, never enabled elsewhere).

## Sub-features

- `signin-dev` signs in with any email; the first sign-in creates the account and opens setup (BR-ACC-01, BR-ACC-06).
- `signin-same-email` signing in again with the same email opens the same account, not a new one (BR-ACC-07).
- `signin-restart` the session survives killing and reopening the app (BR-ACC-03).
- `signin-error` with the API unreachable, the screen says `Can't reach Lumei. Check your connection and try again.` (BR-NFR-05).
- `signin-apple-google` Sign in with Apple and Google: not drivable here (no OAuth clients, no HTTPS API); report as unverified.

## How to get to it (user POV)

- Open the app while signed out: the sign-in screen, with the tagline `See what you can spend today, and still hit your saving target.` and a dashed box `Development only: sign in as any email` in debug builds.

## Driving it with lumei-verify

Preconditions:

- Fresh `$V up` (signed out), `$V doctor` all OK.
- No user with the email exists yet (`$V sql "SELECT email FROM users"` is empty on a fresh stack).

- **See the screen.** Run `$V wait --text "Development only: sign in as any email"` and `$V shot signin-before`. The `Button desc="Sign in"` is disabled (`-` flag in `ui`) while the field is empty. Close the LogBox bar over it first (see Gotchas).
- **Enter the email.** Run `$V tap --desc "Email address"` and `$V type "verify@example.com"`, then `$V key BACK` to close the keyboard. The field shows the email and `Sign in` is enabled.
- **Sign in.** Run `$V tap --desc "Sign in" --exact`. `Signing in…` shows briefly, then setup's first step `Where do you live?` (`$V wait --text "Where do you live?" --timeout 60`).
- **Server side.** Run `$V sql "SELECT u.email, i.provider, i.subject FROM users u JOIN user_identities i ON i.user_id = u.id" --save signin-server`. One row: `verify@example.com | dev | verify@example.com`.
- **Restart.** After setup ([Setup](./setup.md)), kill and reopen the app: `adb -s emulator-5584 shell am force-stop com.anonymous.lumei` and `adb -s emulator-5584 shell am start -n com.anonymous.lumei/.MainActivity`. Home (`Remaining today`) appears without the sign-in screen.
- **Proof.** `shot` before and after the `Sign in` tap, plus `signin-server`.

## Gotchas

- Driven on 2026-11-25 up to setup's first step: the email field (`EditText desc="Email address"`), `Button desc="Sign in"`, and the arrival at `Where do you live?` are confirmed. The restart, error, and server-row steps aren't driven yet.
- The debug build's LogBox bar (`Open debugger to view warnings.`) sits over the `Sign in` button (bounds overlap at y 2605-2671). Tap its close box first: `adb -s emulator-5584 shell input tap 1238 2638`, or tap the small clickable `ViewGroup` at the bar's right end found with `ui`.
- `Sign in` is a substring of `Sign in with Google` and of the dev box title; always pass `--exact`.
- The `Sign in with Google` button is hidden unless `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is set, and Android's `Sign in with Apple` needs `EXPO_PUBLIC_APPLE_SERVICES_ID`; neither is set by `up`, so they normally don't show.
- The dev box exists only in debug (`__DEV__`) builds. A release APK has no way to sign in locally; don't try to verify with one.
- `adb shell input text` drops some characters (`&`, `(`, `)`, `;`, quotes); keep test emails to letters, digits, `@`, `.`, `+`, `-`.
