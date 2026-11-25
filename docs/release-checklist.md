# Release checklist

What's left before Lumei's first release on the App Store and Google Play. Tick items off as they're done, and delete this file after the release.

- **Scope:** the first release, as defined in [`requirements/business-requirements.md`](requirements/business-requirements.md).
- **Owner:** 🧑 marks something only you can do, e.g. creating an account or a credential, or a decision. Everything else can be built in the repo.

## 1. Accounts and credentials 🧑

- [ ] **Apple Developer Program membership.** Sign in with Apple, the App Store, and TestFlight need it.
- [ ] **Real app identifier.** Replace the placeholder `com.anonymous.lumei` (`ios.bundleIdentifier` and `android.package` in `frontend/app.json`). Once it's registered with Apple and Google, it can't change. The backend's `AUTH_APPLE_CLIENT_IDS` uses it too.
- [ ] **Sign in with Apple key** (BR-ACC-05). Create a key with Sign in with Apple enabled in the Apple Developer account, and note its Key ID and your Team ID. They become `AUTH_APPLE_PRIVATE_KEY`, `AUTH_APPLE_KEY_ID`, and `AUTH_APPLE_TEAM_ID`. Without them, account deletion can't revoke Apple sign-ins.
- [ ] **Google OAuth clients** (BR-ACC-01, BR-ACC-05). Create a web, an iOS, and an Android client in Google Cloud.
  - The app needs `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and `GOOGLE_IOS_URL_SCHEME` at build time.
  - The API needs the web client ID as `AUTH_GOOGLE_CLIENT_IDS` and its secret as `AUTH_GOOGLE_CLIENT_SECRET`.
- [ ] **Google Maps API key for Android** (BR-EXP-04): `GOOGLE_MAPS_API_KEY` at build time. Without it, Android shows coordinates instead of a map.
- [ ] **Domain** for the API, with its DNS in Route 53 and an ACM certificate (see [`architecture/aws-infrastructure.md`](architecture/aws-infrastructure.md)).

## 2. Features still to build

- [x] **Account deletion** (BR-ACC-05): Settings → Delete account, and `DELETE /me`.
- [x] **Sign in with Apple on Android** (BR-ACC-01): Apple's web flow, through `POST /auth/apple/callback`, with a nonce.
- [ ] 🧑 **Set up the Apple Services ID** for it (see `store-release.md`, Google Play section 1), and set `EXPO_PUBLIC_APPLE_SERVICES_ID` and `AUTH_APPLE_WEB_CLIENT_IDS`. Apple returns only to a registered HTTPS URL, so it can be tried only against the deployed API, or an HTTPS tunnel to a local one.
- [ ] **Try real sign-ins in a development build** once the credentials exist: Apple and Google sign-in, then deleting the account. Check that revoking works: Lumei disappears from the Apple ID's "Sign in with Apple" list and the Google account's third-party connections.

## 3. Release-blocking audits

Audited and fixed on Nov 9, 2026; the requirements now say how each is met. What's left:

- [x] **BR-NFR-01 Location:** foreground only. The unused "Always" location, motion, full-accuracy, and Face ID permission strings are off, and the location prompt is translated.
- [x] **BR-NFR-02 No third-party sharing:** no analytics, advertising, or crash-reporting SDKs. Category names are out of the server's logs, and Android cloud backup is off. Map display is allowed, and must be disclosed (section 5).
- [x] **BR-NFR-03 Encryption:** a release build refuses a non-HTTPS API. The phone's own encryption is accepted for the on-device database. RDS and logs are encrypted with KMS (infra assumptions).
- [x] **BR-NFR-07 Accessibility:**
  - spoken amounts are final values
  - errors are announced
  - the chart has a full summary and day-by-day reading
  - hidden swipe buttons are out of the screen-reader order
  - controls grow with the font
  - radios, headings, and states are fixed
  - the undo offer stays 15 seconds with a screen reader on
- [x] **BR-NFR-08 Localization:** every string in the app's JavaScript goes through translation. The iOS location prompt and the shortcut's errors are now translated too.
- [ ] **Run a clean prebuild** (`bunx expo prebuild --clean`) and a development build on both platforms. The permission and backup changes only reach the native projects then. The shortcut's error mapping compiles only in the app target.
- [ ] **Try it with VoiceOver and TalkBack** on a real device, and at the largest font size. The tests check labels and states, not how it actually sounds or looks.
- [ ] 🧑 **Native-speaker review** of the Japanese and French text, including the default category names (BR-CAT-07), account deletion, the chart's spoken text, and the location prompt.
- [x] **Smaller accessibility items:**
  - today's ring says its color in words
  - the card-pager dots are tabs with 44-point targets
  - the Android pickers are named for TalkBack
  - item-list fields say their position ("Item 2 of 3")
  - moving a category says where it went
  - the chart's axis labels grow at most 1.3× (its spoken text has the same dates)
- [ ] **French punctuation:** use a non-breaking space before `: ? ; !` throughout `fr.json`, and use apostrophes consistently.

## 4. Infrastructure and delivery

- [ ] **AWS infrastructure in `infra/`.** It's empty. Build what [`architecture/aws-infrastructure.md`](architecture/aws-infrastructure.md) describes:
  - the VPC, ALB, ECS service, RDS, NAT gateway, WAF, and Route 53
  - the Secrets Manager entries the task reads: database credentials, `AUTH_JWT_SIGNING_KEY`, `AUTH_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), the Apple key, and the Google secret
- [x] **Production config guard.** `APP_ENV` is `production` unless set, and the API then refuses to start with the dev sign-in, Expo Go's Apple client ID, or a database connection without TLS.
- [ ] **Run migrations before each deploy** (`cmd/migrate`), e.g. as a one-off ECS task in the deploy pipeline (section 4's infrastructure).
- [ ] **CI on GitHub Actions.** `backend/scripts/run-tests.sh` mentions a test workflow, but none exists. Run `make test` and `make lint` for the backend, and `bun run check` for the app, on every pull request.
- [x] **EAS profiles** in `frontend/eas.json`: development, development-simulator, preview, and production. The production build number is raised by EAS, and Android submits go to the internal track as a draft.
- [ ] 🧑 **Link the project and set its variables:** `bunx eas-cli init` (it writes the project ID into `app.json`), then the variables for each environment, listed in `frontend/CLAUDE.md` › Configuration.
- [ ] **Release build on real devices.** Check performance on a mid-range Android phone and an iPhone, as `frontend/CLAUDE.md` asks.

## 5. Store submission

The step-by-step for each store, including the declarations and forms each one asks for, is in [`store-release.md`](store-release.md).

- [ ] 🧑 **Privacy policy** at a public URL. Both stores require one. It should cover location, financial data, sign-in, and deletion (BR-ACC-05, BR-NFR-01 to BR-NFR-03). It must also say that Apple Maps and Google Maps draw expense maps from their locations (BR-NFR-02).
- [ ] 🧑 **App Store privacy labels** and **Google Play Data safety form**, from the BR-NFR-02 audit.
- [ ] **Account deletion outside the app, for Google Play.** Google Play also needs a web link where users can ask to delete their account and data without the app. This needs a small web page or form. 🧑 Decide which, then add it as a requirement.
- [ ] 🧑 **App Review access.** Reviewers must be able to sign in. Provide a demo Apple or Google account in the review notes. The dev sign-in must stay off in production.
- [ ] 🧑 **Store listings** in English, Japanese, and French: name, description, keywords, screenshots, and the app icon.
- [ ] **TestFlight and Play internal testing** run before submitting.

## 6. Open decisions

- [ ] 🧑 Go through the [Assumptions table](requirements/business-requirements.md#assumptions) in the requirements. Each row is a guess still waiting for your decision. Decide it, or keep it as is, before release.
