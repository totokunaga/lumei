# Releasing on the App Store and Google Play

The steps to publish Lumei on each store, in order. It builds on [`release-checklist.md`](release-checklist.md), which tracks the app's own release work (features, audits, infrastructure). This file covers the stores.

- **Owner:** 🧑 marks something only you can do: an account, a payment, a legal answer, or a decision. Everything else can be done in the repo.
- **Rules change often.** The store policies, screenshot sizes, and target API levels below are as understood in November 2026. Check each against the store's current documentation when you submit.

## Before either store

These are needed for both.

- [ ] **The API in production** over HTTPS, at its own domain (see `release-checklist.md` section 4).
  - A release build refuses any other URL (BR-NFR-03).
  - Set `EXPO_PUBLIC_API_URL` in the production build profile.
- [ ] 🧑 **App identifier.** Choose the real one, e.g. `com.<yourdomain>.lumei`, to replace `com.anonymous.lumei` in `frontend/app.json`, both `ios.bundleIdentifier` and `android.package`. Neither can change after the first upload.
- [ ] **EAS.** Run `bunx eas-cli init`, then add `frontend/eas.json` with `development`, `preview`, and `production` profiles. Store build-time secrets as EAS secrets:
  - `GOOGLE_MAPS_API_KEY`
  - `GOOGLE_IOS_URL_SCHEME`
  - the `EXPO_PUBLIC_GOOGLE_*` client IDs
- [ ] **Version numbers.** `expo.version` (e.g. `1.0.0`) is what users see. Let EAS raise the build number on each build (`"autoIncrement": true` with `"appVersionSource": "remote"`).
- [ ] 🧑 **Privacy policy** at a public URL, in English, Japanese, and French. It should cover:
  - what is stored: expenses, income, locations, and the email address
  - that sync goes to Lumei's server
  - that Apple Maps and Google Maps draw expense maps from their locations (BR-NFR-02)
  - that sign-in goes through Apple and Google
  - how to delete the account (BR-ACC-05)
  - a contact address
- [ ] 🧑 **Support URL and contact email.** The App Store requires a support URL, and Google Play shows the email.
- [ ] 🧑 **Native-speaker review** of the Japanese and French text, in the app and in the store listings.
- [ ] 🧑 **Google Cloud OAuth consent screen.** Set it up for Google sign-in, on both stores:
  - the app's name, logo, support email, privacy policy URL, and authorized domains
  - only the basic scopes (email, profile, openid), so no sensitive-scope review is needed
  - publish it to "In production", since Google limits the "Testing" status to listed test users
  - with a logo, Google may also ask for brand verification

## Apple App Store

### 1. Account and identifiers

- [ ] 🧑 **Apple Developer Program** membership (paid, yearly), as an individual or an organization. An organization needs a D-U-N-S number, and its name is the seller shown on the store.
- [ ] 🧑 **Agreements, tax, and banking** in App Store Connect. The free-apps agreement is enough for a free app.
- [ ] **Bundle ID** registered with the **Sign in with Apple** capability. EAS registers it on the first build, or add it in Certificates, Identifiers & Profiles.
- [ ] 🧑 **Sign in with Apple key** (.p8). Pass it, its Key ID, and your Team ID to the API as `AUTH_APPLE_PRIVATE_KEY`, `AUTH_APPLE_KEY_ID`, and `AUTH_APPLE_TEAM_ID`. Account deletion revokes Apple sign-ins with it, which App Review checks (BR-ACC-05).
- [ ] **API config.** Set `AUTH_APPLE_CLIENT_IDS` to the real bundle ID only, never `host.exp.Exponent`.
- [ ] **Google sign-in on iOS.** Create an iOS OAuth client for the bundle ID, then set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `GOOGLE_IOS_URL_SCHEME`.

### 2. App configuration

- [ ] **Export compliance.** The app uses only standard HTTPS, which is exempt. Add `"ITSAppUsesNonExemptEncryption": false` under `ios.infoPlist` in `app.json`, so each build skips the question. France has its own encryption declaration rules; App Store Connect asks about it if needed.
- [ ] **Privacy manifest.** Apple requires one (`PrivacyInfo.xcprivacy`).
  - Expo generates it from `ios.privacyManifests` in `app.json` and the libraries' own manifests.
  - Declare the reasons for any "required reason" APIs the app or its libraries use, e.g. UserDefaults and file timestamps. Check the warnings App Store Connect sends after the first upload.
  - The app doesn't track users, so `NSPrivacyTracking` is false and there is no App Tracking Transparency prompt.
- [ ] **iPhone only.** `ios.supportsTablet` isn't set, so the app runs on iPad only in iPhone compatibility mode and needs no iPad screenshots. Set it to `true` only if iPad gets its own layout.
- [ ] **Clean prebuild and device test.** Run `bunx expo prebuild --clean`, then check on a device:
  - only the "While Using" location prompt appears, in the device language
  - the Add Expense shortcut works
  - signing in with Apple and Google works
  - deleting the account removes Lumei from Settings → Apple ID → Sign in with Apple

### 3. App Store Connect record

- [ ] **New app**, with:
  - the name, e.g. "Lumei" (up to 30 characters)
  - the primary language
  - the bundle ID and an SKU
  - the category: Finance, with Productivity as the secondary
- [ ] 🧑 **App Privacy (privacy labels).** From the BR-NFR-02 audit:
  - **Collected and linked to the user:** financial info (expenses and income); precise location (of expenses, when the user allows it); contact info (email address); user ID.
  - **Purpose:** app functionality only. Nothing is used for tracking, advertising, or analytics.
  - **Sharing:** say that maps are drawn by Apple Maps.
- [ ] 🧑 **Age rating** questionnaire. It has no objectionable content, so expect 4+.
- [ ] 🧑 **Pricing and availability:** free, and the countries to offer it in. It should match the regions the app supports (BR-SET-06): Japan, the EU, and others.
- [ ] 🧑 **EU Digital Services Act trader status.** Declare whether you're a trader, which is required to distribute in the EU. A trader's address, phone, and email are shown on the EU store.
- [ ] 🧑 **Store listing**, in English, Japanese, and French:
  - the subtitle (30 characters)
  - the description, the keywords (100 characters), and the promotional text
  - the support and privacy policy URLs
- [ ] **Screenshots.** At least one set for the largest iPhone size App Store Connect asks for (6.9" today), in each language. Show:
  - today's allowance
  - the chart
  - recording an expense
  - the period summary
  - spending by category
- [ ] **App icon.** The 1024 × 1024 icon comes from `ios.icon` (`assets/expo.icon`) in the build.

### 4. Build, test, and submit

- [ ] **Build and upload:** `bunx eas-cli build -p ios --profile production`, then `bunx eas-cli submit -p ios`. EAS manages the certificates and provisioning profile.
- [ ] **TestFlight.** Internal testers need no review. External testers need a short beta review, so test there first.
- [ ] 🧑 **App Review notes.** Lumei has no password sign-in, and the dev sign-in is off in production.
  - Tell reviewers to sign in with Sign in with Apple using their own Apple ID, or give them a demo Google account.
  - Explain that a new account starts with setup.
  - Point out the account deletion screen: Settings → Delete account.
  - Mention the Add Expense action in the Shortcuts app.
- [ ] **What App Review checks**, and where Lumei stands:
  - Sign in with Apple is offered next to Google, as Guideline 4.8 requires.
  - Account deletion is in the app and revokes the Apple tokens (Guideline 5.1.1(v)).
  - Location is asked for only when needed, with a clear purpose string.
  - Nothing is left over from testing.
- [ ] **Submit for review**, then release by hand or automatically once approved. A phased release lets you roll back an update before everyone gets it.

## Google Play

### 1. Account and identifiers

- [ ] 🧑 **Google Play Console developer account** (a one-time fee), with identity verification.
  - Choose a personal or organization account; an organization needs a D-U-N-S number.
  - A new **personal** account must run a **closed test with at least 12 testers for 14 days in a row** before it can publish to production. Plan for that time.
- [ ] **Play App Signing** (on by default). EAS creates the upload key on the first Android build. Google holds the key that signs what users install.
- [ ] **Google sign-in on Android.**
  - Create an Android OAuth client for the package name with the SHA-1 fingerprint of **Play's app signing key**, under Play Console → Test and release → App integrity. The upload key's fingerprint isn't enough: Google sign-in would fail in the Play build.
  - Add the upload key's SHA-1 too, for builds installed outside Play.
- [ ] **Google Maps API key.** Restrict it to Android apps, with the package name and both SHA-1 fingerprints, and pass it as `GOOGLE_MAPS_API_KEY` at build time.
- [ ] **API config.** `AUTH_GOOGLE_CLIENT_IDS` holds the web client ID, which is the audience of Google ID tokens, and `AUTH_GOOGLE_CLIENT_SECRET` holds its secret, for revoking at account deletion (BR-ACC-05).
- [ ] 🧑 **Sign in with Apple on Android** (BR-ACC-01): build it, or ship the first release with Google only.
  - Without it, someone who signed up with Apple on iPhone can't sign in on Android.
  - That's fine if their Apple ID's email is a real address, which Google sign-in then matches (BR-ACC-07).
  - It's not fine with Apple's private relay address, which Google can't match.

### 2. App configuration

- [ ] **Target API level.** Google Play requires new apps and updates to target a recent Android version (API 35 or newer as of 2025). Expo SDK 58 sets a current `targetSdkVersion`; check the value in the build and Play Console's warnings.
- [ ] **App bundle.** EAS production builds make an `.aab`, which Play requires.
- [ ] **Permissions.** Only `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`, with no background location, so no location permission declaration is needed. Check the merged manifest after a clean prebuild.
- [ ] **Backups.** `android.allowBackup` is false, so the expense database isn't copied to Google Drive (BR-NFR-02).
- [ ] **Device test.** On a release build on a mid-range phone, check:
  - the location prompt
  - the map (with the key) or the coordinates (without it)
  - Google sign-in from the Play-signed build of the internal test track
  - deleting the account removes Lumei from the Google account's third-party connections

### 3. Play Console setup

- [ ] **Create the app:**
  - the name (up to 30 characters) and the default language
  - app, not game
  - free (a free app can never become paid)
- [ ] 🧑 **App content declarations**, in Policy → App content:
  - **Privacy policy:** the URL.
  - **Ads:** the app contains no ads.
  - **App access:** sign-in is required. Give reviewers a demo Google account and say a new account starts with setup.
  - **Content rating:** the IARC questionnaire. There is no objectionable content.
  - **Target audience:** adults (18+), since it handles money; not designed for children.
  - **Data safety form:**
    - **Collected:** financial info (purchase history: expenses and income), precise location (optional, of expenses), personal info (email address), and app info (user IDs).
    - **Purpose and handling:** app functionality only. Encrypted in transit. Users can ask for their data to be deleted. Not shared, except that Google Maps draws the maps (BR-NFR-02).
  - **Account deletion:**
    - the in-app path: Settings → Delete account
    - a **web link where users can ask for deletion without the app**, which Play requires
    - 🧑 Decide what that page is (a form, or an email address with instructions), then add it to the requirements and build it.
  - **Financial features declaration:** Lumei is a personal budgeting tracker. It offers no loans, payments, banking, or investments.
  - **Government app / news app / health:** no.
- [ ] 🧑 **Store listing**, in English, Japanese, and French:
  - the short description (80 characters) and full description (4,000 characters)
  - the app icon (512 × 512) and the feature graphic (1024 × 500)
  - at least 2 phone screenshots, the same scenes as for iOS
  - the category: Finance
  - the contact email, and optionally a website
- [ ] 🧑 **Countries and regions:** the same as on the App Store.

### 4. Build, test, and release

- [ ] **Build and upload:** `bunx eas-cli build -p android --profile production`.
  - The first upload must go through Play Console by hand.
  - After that, `bunx eas-cli submit -p android` uploads automatically, with a Google service account JSON key that has release permissions.
- [ ] **Internal testing track:** up to 100 testers, no review, and it's available within minutes. Use it to check sign-in with Play's signing key.
- [ ] **Closed testing:**
  - For a new personal account, run it with at least 12 testers for 14 days, then apply for production access in Play Console.
  - An organization account can skip the waiting period, but a closed test is still worth it.
- [ ] **Production release.** Send it for review, which takes from a few hours to several days for a new app. Use a **staged rollout**, e.g. 20%, then raise it while the Android vitals (crashes, ANRs) stay clean.

## After release, on both stores

- [ ] **Watch** App Store Connect's crashes and Play Console's Android vitals. The app has no crash reporting of its own (BR-NFR-02).
- [ ] **Keep the backend ready for older apps.** It must keep serving app versions still in use, so add API changes without breaking them (see the migration rules in `backend/CLAUDE.md`).
- [ ] **Policy deadlines.** Each year Apple raises the minimum Xcode and SDK version for uploads, and Google raises the target API level. Upgrade Expo's SDK before those deadlines.
