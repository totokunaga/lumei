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
- [ ] **Sign in with Apple on Android** (BR-ACC-01). It needs Apple's web flow and a Services ID, which joins `AUTH_APPLE_CLIENT_IDS`. Today Android offers Google only.
- [ ] **Try real sign-ins in a development build** once the credentials exist: Apple and Google sign-in, then deleting the account. Check that revoking works: Lumei disappears from the Apple ID's "Sign in with Apple" list and the Google account's third-party connections.

## 3. Release-blocking audits

Each one ends either with a fix or with a note in the requirements saying how the app meets it.

- [ ] **BR-NFR-01 Location.** Location is read only with permission, and only while an expense is being recorded or when the user taps "Add current location". Check:
  - Nothing requests background location.
  - The permission text in `app.json` (iOS `NSLocationWhenInUseUsageDescription`, Android permissions) is accurate, in all three languages.
  - The Add Expense shortcut uses only Shortcuts' own location permission.
- [ ] **BR-NFR-02 No third-party sharing.**
  - **Data leaving the device:** list every library that sends anything off the device (Google Sign-In, Google Maps on Android, Apple Maps, Expo modules), and confirm none sends financial or location data, or gets used for advertising or analytics.
  - **Store answers:** this list feeds the App Store privacy labels and Google Play's Data safety form (section 5).
- [ ] **BR-NFR-03 Encryption.**
  - **In transit:** only HTTPS, through the ALB with an ACM certificate. Check that the production app never calls plain HTTP: `EXPO_PUBLIC_API_URL`, iOS App Transport Security, and Android cleartext traffic.
  - **At rest on AWS:** RDS storage encryption on, plus Secrets Manager. The stored Apple and Google tokens are also encrypted by the API.
  - **At rest on the device:** 🧑 decide whether the OS's file encryption is enough for the SQLite files. iOS Data Protection and Android file-based encryption both encrypt while the device is locked. If not, add SQLCipher. Then record the decision in the requirements.
- [ ] **BR-NFR-07 Accessibility.**
  - **Screen readers:** a full VoiceOver and TalkBack pass on every screen.
  - **Font size:** the largest OS sizes, checking that nothing gets cut off.
  - **Text equivalents:** every number on the home screen and chart has one (the chart needs a text summary).
  - **Reduce Motion and Reduce Transparency:** check both are respected.
- [ ] **BR-NFR-08 Localization.**
  - **Hard-coded text:** find user-facing strings that aren't translated, including errors, alerts, permission prompts, and the shortcut.
  - 🧑 **Native-speaker review** of the Japanese and French text, including the default category names (BR-CAT-07) and the new account-deletion screen.

## 4. Infrastructure and delivery

- [ ] **AWS infrastructure in `infra/`.** It's empty. Build what [`architecture/aws-infrastructure.md`](architecture/aws-infrastructure.md) describes:
  - the VPC, ALB, ECS service, RDS, NAT gateway, WAF, and Route 53
  - the Secrets Manager entries the task reads: database credentials, `AUTH_JWT_SIGNING_KEY`, `AUTH_TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), the Apple key, and the Google secret
- [ ] **Production config.**
  - `AUTH_DEV_SIGN_IN` stays false.
  - `AUTH_APPLE_CLIENT_IDS` lists only Lumei's bundle ID and Services ID, never `host.exp.Exponent`.
  - Migrations run before each deploy (`cmd/migrate`).
- [ ] **CI on GitHub Actions.** `backend/scripts/run-tests.sh` mentions a test workflow, but none exists. Run `make test` and `make lint` for the backend, and `bun run check` for the app, on every pull request.
- [ ] **EAS Build and Submit.** Add `frontend/eas.json` with development, preview, and production profiles. Set the production `EXPO_PUBLIC_API_URL` and the build-time keys, and use EAS secrets for anything secret.
- [ ] **Release build on real devices.** Check performance on a mid-range Android phone and an iPhone, as `frontend/CLAUDE.md` asks.

## 5. Store submission

- [ ] 🧑 **Privacy policy** at a public URL. Both stores require one. It should cover location, financial data, sign-in, and deletion (BR-ACC-05, BR-NFR-01 to BR-NFR-03).
- [ ] 🧑 **App Store privacy labels** and **Google Play Data safety form**, from the BR-NFR-02 audit.
- [ ] **Account deletion outside the app, for Google Play.** Google Play also needs a web link where users can ask to delete their account and data without the app. This needs a small web page or form. 🧑 Decide which, then add it as a requirement.
- [ ] 🧑 **App Review access.** Reviewers must be able to sign in. Provide a demo Apple or Google account in the review notes. The dev sign-in must stay off in production.
- [ ] 🧑 **Store listings** in English, Japanese, and French: name, description, keywords, screenshots, and the app icon.
- [ ] **TestFlight and Play internal testing** run before submitting.

## 6. Open decisions

- [ ] 🧑 Go through the [Assumptions table](requirements/business-requirements.md#assumptions) in the requirements. Each row is a guess still waiting for your decision. Decide it, or keep it as is, before release.
