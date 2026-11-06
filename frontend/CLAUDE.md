# CLAUDE.md (frontend)

React Native app for Lumei (iOS and Android): Expo SDK 58, Expo Router, TypeScript, NativeWind, Reanimated, Liquid Glass (`expo-glass-effect`), `@expo/ui`, TanStack Query, Zustand, React Hook Form + Zod, i18next. It calls the Go API in `backend/` (see `docs/architecture/aws-infrastructure.md`).

## Expo changes often: don't trust your training data

Expo ships breaking changes in every SDK release. Before writing code that touches an Expo, EAS, or React Native API:

1. Read the major version of `expo` in `package.json`.
2. Read the matching versioned docs at `https://docs.expo.dev/versions/v<major>.0.0/`.
3. For anything else, start from https://docs.expo.dev/llms.txt, which indexes every Expo doc and corrects common LLM misconceptions.

## Commands

Run every command from `frontend/`. Bun is the package manager; use `bunx`, never `npx`.

```bash
bun install                  # Install dependencies
bun run start                # Start the Metro dev server
bun run ios                  # Start and open the iOS simulator (also: android)
bun run check                # typecheck + lint + test; run before declaring any task done
bun run typecheck            # tsc --noEmit
bun run lint                 # ESLint (eslint-config-expo) with Prettier as a rule (lint:fix to auto-fix)
bun run format               # Prettier on every file
bun run test                 # Jest (test:watch to watch)
bun run test -- -t "name"    # One test
bun run generate:api         # Regenerate src/api/generated/ from backend/api/index.yaml
bun run db:generate          # Write a drizzle/ migration after changing src/db/schema.ts
bun run map:generate         # Rebuild the region map's data and relief from Natural Earth (scripts/)
bun run doctor               # expo-doctor: dependency and config checks
bunx expo install <package>  # Add a dependency
```

- **Add dependencies only with `bunx expo install <package>`** (add `--dev` for dev dependencies), never `bun add`. It picks the version that matches the Expo SDK. Use `bun add` only for a package `expo install` resolves wrongly, and say why in the commit.
- **orval runs through `bunx orval@<version>`** (pinned in `generate:api`), not as a dev dependency. Installed next to ESLint, it gets ESLint's `ajv` 6 instead of the `ajv` 8 it needs, and crashes.
- **ESLint stays on 9** until `eslint-plugin-expo` supports 10.

## Configuration

- The API base URL comes from `EXPO_PUBLIC_API_URL` (default `http://localhost:18080`, the API from `make up-d` in `backend/`). Override it in `.env.local`, which is gitignored. The Android emulator reaches the host at `http://10.0.2.2:18080`.
- Every `EXPO_PUBLIC_*` variable is compiled into the app bundle, so anyone can read it. Never put a secret there.
- **iOS and Android only.** There is no web build (`platforms` in `app.json`), because the app relies on native secure storage and native sign-in. Don't add `react-native-web` back or write `Platform.OS === 'web'` branches.
- Configure native behavior in `app.json` and config plugins. `ios/` and `android/` are generated (Continuous Native Generation) and gitignored; never create or edit them by hand.
- **Sign-in config** (BR-ACC-01). Each provider's button appears only when it is configured:
  - **Google:** set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the audience the API checks), `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and, at build time, `GOOGLE_IOS_URL_SCHEME`. `app.config.ts` adds Google Sign-In's config plugin only when the scheme is set, because the plugin fails the build without one.
  - **Apple:** iOS only for now. Android needs a web flow, which comes later.
  - **Development builds:** the sign-in screen also offers sign-in as any email. It works only against an API with `AUTH_DEV_SIGN_IN=true`, as `make up-d` sets.
- **On-device data** (see `docs/architecture/offline-sync.md`). Screens read and write the account's SQLite database through `src/db/`, never the API, so the app works offline. Each account has its own database file, opened by the root layout after sign-in and deleted on sign-out (BR-ACC-04).
  - Every table spreads `syncColumns()` from `src/db/schema.ts`, and every write sets `updatedAt` and marks the row `pending` (see `saveSetup`).
  - IDs come from `src/db/ids.ts`: `newId()` for a new record, `derivedId(...)` for a record two devices could both create offline (settings, default categories, periods, targets).
  - After changing `src/db/schema.ts`, run `bun run db:generate`, rename the new migration to say what it does (e.g. `0001_expenses.sql`, also in `drizzle/meta/_journal.json` and `drizzle/migrations.js`), and commit the new files in `drizzle/`. Never edit an existing migration.
  - **Syncing** (BR-OFF-03 to BR-OFF-05): the root layout mounts `useSync` (`src/sync/scheduler.ts`) while the account's database is open. It runs `syncOnce` (`src/sync/engine.ts`): push the pending rows, then pull. Call `requestSync()` to sync now, e.g. before signing out; it never runs two cycles at once. Screens never call the sync endpoints. The device and API share every column name, so a new column needs no sync code, only the same column in the backend's table and TypeSpec model. A row the API rejected keeps its code in `syncError` and isn't pushed again: a write that changes a row must set `pending: true`, `syncError: null`, and the next `localRev`.
  - **Live updates** (BR-DSH-04, BR-NFR-04): every write in `src/db/records.ts` ends with `notifyChange()` (`src/db/changes.ts`). The sync engine's writes call `notifyChange('sync')`, which updates screens but doesn't start another sync. A screen showing records reads them in a `useMemo` that depends on `useDataVersion()`, so it reads them again after any write. Don't use Drizzle's `useLiveQuery`: it relies on expo-sqlite's change listener, which the sql.js test database doesn't have.
  - **Today** is `useToday()` (`src/db/use-today.ts`) on screens, not `localToday()`: it moves at local midnight and when the app returns to the foreground on a later day (BR-DSH-05), creating the next period first when the old one has ended (BR-PER-03). Opening the database does the same for periods that started while the app was closed.
  - **Editing items:** `saveIncomes` and `saveFixedExpenses` take the period's whole list as the user left it, and write only the rows that changed, so keep each item's `id` through the form (`ItemListForm` does). A saving target is never deleted, only set to 0: its ID derives from its period's, and a deleted row can't come back.
  - **Expenses** have no period ID: their `date` (the local date when they happened, `expenseDate(spentAt)`) decides their period (BR-EXP-07). Keep a chosen date and time within `clampSpentAt` (BR-EXP-02).
- **Navigation:** signed in, the app is native tabs (`src/app/(tabs)/_layout.tsx`, from `expo-router/native-tabs`): Home and Settings. A tab that pushes screens is a folder with its own `Stack` (`(tabs)/settings/`). Native tabs can't report their height, so content that floats above the tab bar or must scroll clear of it adds `TAB_BAR_CLEARANCE` (`src/lib/layout.ts`) to the bottom inset. In tests, open a tab by its URL (`renderRouter(routes, { initialUrl: '/settings' })`), and add every new route file to `test/helpers/routes.ts`.
- **Platform files:** a component that differs per platform goes in `<name>.ios.tsx` and `<name>.android.tsx`, which Metro picks between, plus a `<name>.tsx` that re-exports the iOS one for TypeScript (see `src/components/menu-picker.tsx` and `date-time-field.tsx`).
- **World map** (the region step): `bun run map:generate` builds it from Natural Earth's data (public domain); don't edit its output by hand.
  - `src/domain/world-map.json`, from the 1:10m countries, lakes, and disputed areas (`scripts/world-map.ts`): each country's path and the box around its mainland, which the map zooms to, and the disputed areas a seed region's country is party to (BR-SET-06). Areas shown as their administrator's instead (Senkaku) are listed in `UNDISPUTED`.
  - `assets/images/relief/*.jpg` and `src/components/relief-tiles.ts`, from the 1:50m shaded relief (`scripts/relief.ts`): the terrain, as one low-resolution world image plus a sharper tile per region of the backend's seed data.
  - Run it again after adding a region to the seed data, so the region gets its own sharp tile and its disputed areas.
- Expo Go only includes its own native modules. Google Sign-In isn't one of them, so `src/auth/providers.ts` loads it only when Google sign-in runs, and hides the button in Expo Go. After adding a library with native code (e.g. Google Sign-In), use a development build: `bunx expo run:ios|android`, or `bunx eas-cli build --profile development`.

## Layout

| Path                 | Contents                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/app/`           | Expo Router routes only: every file is a screen, `_layout.tsx` files define navigators. Keep all other code out of it.  |
| `src/api/client.ts`  | `apiFetch`, the fetch function every generated API call goes through (orval mutator)                                    |
| `src/api/generated/` | Generated by orval: TanStack Query hooks per OpenAPI tag, models in `model/`. Don't edit by hand.                       |
| `src/auth/`          | Sign-in: the session store (`useAuth`), the session in secure storage, the Apple and Google sign-in calls, and sign-out |
| `src/db/`            | The account's on-device SQLite database (Drizzle): schema, client, record reads and writes, `useLocalData`, record IDs  |
| `src/sync/`          | The sync engine (`syncOnce`), when it runs (`useSync`, `requestSync`, `useSyncStatus`), and row conversion              |
| `src/setup/`         | Setup's draft (`useSetupDraft`) and saving it (`finishSetup`)                                                           |
| `src/components/`    | Components shared by screens (e.g. `PressableScale`)                                                                    |
| `src/i18n/`          | i18next setup and `locales/{en,ja,fr}.json`                                                                             |
| `src/domain/`        | Business rules as pure functions, no React or I/O: dates, periods, money, and the calculations (BR-CALC)                |
| `src/lib/`           | App-wide singletons and helpers (e.g. the `QueryClient`)                                                                |
| `src/global.css`     | Tailwind entry point, imported once in `src/app/_layout.tsx`                                                            |
| `test/`              | Jest tests, mirroring `src/` (e.g. `test/app/index.test.tsx` tests `src/app/index.tsx`)                                 |

Import from `src/` with the `@/` alias (`@/api/generated`), not relative paths.

## Code style

- **Styling:** NativeWind `className` with Tailwind classes. Use `StyleSheet` only for what classes can't express (e.g. computed values). Give every color a `dark:` variant; the app follows the system theme.
- **Text fields:** use `TextField` (`src/components/text-field.tsx`), or `AmountInput` for amounts, never a bare `TextInput`. Set the size with its `fontSize` prop, not a Tailwind `text-*` class: those also set a line height, and on iOS a text field with one draws its text below the middle.
- **Server data:** Use the generated hooks (`useGetHealth`) and functions; never call `fetch` directly. **Local state:** Zustand. **Forms:** React Hook Form with a Zod schema.
- **Sessions:** `apiFetch` sends the access token (a JWT valid for 15 minutes) and keeps it fresh. It refreshes the token through the auth store a minute before expiry, or after a 401, then retries once. Concurrent requests share one refresh, since each refresh replaces the refresh token. Never send `Authorization` yourself, and never call `refreshSession` outside `src/auth/store.ts`.
- **Generated responses:** they are `{ data, status, headers }`, and an HTTP error status resolves instead of throwing. Read `res.data` and branch on `res.status` where the API documents error responses (e.g. `503` from `/health/full`). A network failure rejects, and the query's `isError` is set.
- **Text:** never hard-code text the user sees. Add a key to all three of `src/i18n/locales/en.json`, `ja.json`, and `fr.json`, and use `t('key')`. Keys are typed from `en.json`, so an unknown key fails `typecheck`, and `test/i18n/locales.test.ts` fails if `ja.json` or `fr.json` lacks a key or has an extra one.
- **Money and dates:** use `src/domain/`. Amounts are integers in the currency's minor unit (BR-NFR-06): parse input with `parseAmount` and display with `formatMoney`. Dates are `IsoDate` strings (`YYYY-MM-DD`), never `Date`; get today with `localToday()`. Use `Fraction` for values that divide by days (chart shares and limits), and round them only for display.
- **Business logic** goes in `src/domain/`, not in screens or hooks, so it is testable without rendering and works offline. Screens only call it and display the results.
- **Comment every function and method,** exported or not, with a JSDoc block (`/** … */`):
  - **What it does,** in a sentence starting with a verb ("Works out…", "Checks whether…"), including any business rule it follows.
  - **`@returns`** what it returns, with an example value where it helps (`31 for Oct 25 – Nov 24`), and what `null` or a negative value means. Skip `@returns` only for functions that return nothing.
  - **`@throws`** when it can throw, and on what input.
  - **`@param`** only for parameters whose meaning or unit the name and type don't make clear (e.g. `amount` in minor units).
  - **Components and hooks:** say what the component renders, or what the hook returns.
  - Inline callbacks passed straight to another function (e.g. `.map((e) => e.amount)`) don't need one.
  - `src/domain/` is the reference example.
- Cite the requirement IDs you implement (e.g. `BR-EXP-01`) in comments and test names (see the root `CLAUDE.md`).

## Design

Lumei should feel like a current, top-tier native app: modern platform materials, fluid motion, and moments of delight that make people want to come back and log a purchase. A plain, static screen is not done. Delight never comes at the cost of frame rate, battery, or accessibility.

### Use the modern platform look

- **iOS: Liquid Glass.** Build floating chrome (tab bar, toolbars, the quick-add button, sheets, overlays on top of content) from Liquid Glass.
  - **Use native components first:** they get Liquid Glass for free.
    - Tabs: `NativeTabs` from `expo-router/native-tabs`, not a JS tab bar.
    - Native headers and form sheets: the `Stack` from `expo-router`.
    - System controls: `@expo/ui/swift-ui` (`Host`, `Button`, `Picker`, `DatePicker`, `ContextMenu`, `BottomSheet`, `GlassEffectContainer`).
  - **Custom glass surfaces:** `GlassView` from `expo-glass-effect`. Use `glassEffectStyle` `'regular'` for controls and `'clear'` over rich content, `isInteractive` for things the user presses, and `tintColor` for an accent.
    - Wrap glass elements that sit near each other in a `GlassContainer` with `spacing`, so they merge and separate fluidly.
- **Glass goes on the layer above the content, never on the content itself.** Lists, numbers, and charts sit on solid backgrounds; glass floats over them. Don't stack glass on glass, and keep text on glass short and bold enough to read over any backdrop.
- **Always have a fallback.**
  - Render `GlassView` only when `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()` are both true. Otherwise use a solid, slightly translucent surface with a hairline border.
  - Also use the solid surface when `AccessibilityInfo.isReduceTransparencyEnabled()` is true.
  - This is `GlassSurface` (`src/components/glass-surface.tsx`); use it rather than `GlassView` in screens.
- **Android: Material 3 Expressive.** Don't imitate iOS glass on Android. Use `@expo/ui/jetpack-compose` components and Material You dynamic color, with expressive shapes and smooth eased motion (no bouncing). Keep layout and behavior the same on both platforms; only the materials differ.
- **Icons:** SF Symbols on iOS and Material Symbols on Android through `SymbolView` from `expo-symbols`, not PNG icons. Animate symbols (e.g. a pulse on save, never a bounce) where it adds meaning.
- **Typography and layout:**
  - **Type:** system fonts with Dynamic Type, bold and oversized for the key numbers. Today's allowance (BR-DSH) is the hero of the home screen.
  - **Shape and space:** generous spacing, large continuous corner radii, and safe-area-aware edge-to-edge layouts.
  - **Color:** a restrained palette with one vivid accent, and every color has a `dark:` variant.

### Make it fascinating

Take in distinctive, current design ideas actively rather than defaulting to stock screens. Each new screen or feature should have at least one moment that feels alive. Good places for it in Lumei:

- **Numbers that move:** today's allowance and the remaining amount count up or down to their new value instead of jumping.
- **Feedback on every action:**
  - **No bouncing.** Don't use springs (`withSpring`, `.springify()`): motion eases to a stop without overshooting. Use `withTiming` with `EASE_OUT`, and the shared animations in `src/components/motion.ts` (`riseIn` for entrances, `listLayout` for list rows).
  - Buttons and cards scale slightly on press.
  - Saving an expense plays a short success animation with a haptic tap (`expo-haptics`, added with `bunx expo install` when first needed).
  - Going over today's allowance gets a distinct, gentler haptic and color shift.
- **Shared-element and layout transitions:**
  - Reanimated layout animations (`entering`, `exiting`, `layout`) for list rows being added, edited, or swiped away.
  - Native zoom and sheet transitions from `expo-router` between screens.
- **Live charts (BR-CHT):** bars and the cumulative line draw in on first show and morph smoothly when data changes; dragging across the chart scrubs with haptic ticks.
- **Celebrations at milestones:** reaching the saving target, or a streak of days under the allowance, gets a short, tasteful celebration (particles, a glow, an animated symbol), at most once per milestone.
- **Depth and texture:** subtle gradients, glows, and parallax on scroll, kept quiet enough that the numbers stay the focus.

Keep every animation short (about 150–400 ms for feedback, under 1 s for celebrations) and interruptible. Motion must explain what happened; drop any animation that only decorates and slows the user down.

### Keep it fast

Target a steady 60 fps (120 fps on ProMotion devices) on a mid-range Android phone, not just the newest iPhone.

- **Animate on the UI thread:** Reanimated shared values, `useAnimatedStyle`, and worklets, or Reanimated 4's CSS animations and transitions. Never animate with `setState` or React `Animated` driven from JS.
  - **The one exception is counting numbers:** a text's content can't be animated on the UI thread. Show every displayed amount that can change with `CountingText` (`src/components/counting-text.tsx`), which counts in about 450 ms. Keep it to short texts like an amount, never inside list rows. Inputs don't count.
- **Animate only `transform` and `opacity`** where possible. Animating layout props (`width`, `height`, `margin`) or shadows re-lays out every frame.
- **Draw rich graphics with Skia** (`@shopify/react-native-skia`, which Victory Native XL also uses) instead of stacking many views.
- **Use glass and blur sparingly:** they are costly to render. Use a few glass surfaces per screen, never inside list rows, and never animate their size on every frame.
- **Lists:** use FlashList (or Legend List) for long ones, with stable keys and memoized rows. Don't put heavy animation in every row; animate rows only as they enter, leave, or move.
- **Celebrations and particles:** pause them when the screen isn't focused, and keep particle counts small.
- **Respect Reduce Motion.** With `useReducedMotion()` (Reanimated) set, replace movement with a short fade, and pass `reduceMotion: ReduceMotion.System` to animations. Never hide information behind an animation.
- **Check performance in a release build on a real device,** not in the dev build, which is far slower. Use the performance monitor from the dev menu, and React DevTools' profiler for re-renders. Any animation that drops frames gets simplified or removed.

## API changes

The client is generated from `backend/api/index.yaml`. After the backend's TypeSpec changes and `make oapi-codegen` runs, run `bun run generate:api` and commit the regenerated `src/api/generated/` in the same change.

## Testing

- Jest with the `jest-expo` preset and React Native Testing Library. Tests live in `test/`, mirroring `src/`, named `<file>.test.ts(x)`.
- **Table-driven:** write cases as an array passed to `it.each`, with a `name` used in the title (`'returns $name'`), as the backend does. The next case is a new element, not a new `it`.
- Find elements the way the user does: `screen.findByText`, `getByRole`, not test IDs, unless nothing else works.
- Mock the network at `globalThis.fetch` (`jest.spyOn(globalThis, 'fetch')`), so tests also cover `apiFetch` and the generated client. Give each test its own `QueryClient` with `retry: false, gcTime: Infinity`, so failures show up at once and no cache timer outlives the test.
- Mock native modules with `jest.mock` (e.g. `expo-localization`) and set per-case values in the case's setup. A mock that renders components goes in its own file under `test/helpers/`, loaded with `jest.mock('<module>', () => require('../helpers/<file>'))`, because NativeWind's JSX transform breaks JSX inside a `jest.mock` factory.
- **Await every `render`, `renderRouter`, and `fireEvent` call:** they are async in React Native Testing Library 14. An un-awaited `fireEvent` runs out of order with the next one, and React warns about overlapping `act()` calls.
- **Shared setup:** `test/setup.ts` runs before every test file. It gives `expo-secure-store` and `expo-sqlite/kv-store` in-memory stores, and replaces `src/db/client.ts` with `test/helpers/database.ts`: the same functions on in-memory sql.js databases, migrated from `drizzle/`. All are emptied before each test.
- **Accounts:** `finishedSetup()` (`test/helpers/account.ts`) saves a finished setup for `testUser`, as an earlier session would have, and `savedExpenses([...])` adds expenses after it, not synced yet; `syncedRecords()` marks everything synced. Without `finishedSetup()`, a signed-in test downloads the account's data first, and lands on setup if the API has none. `routes` (`test/helpers/routes.ts`) lists every route file for `renderRouter`. Fake the API with `mockApi({ 'GET /me': json(200, …) })` from `test/helpers/api.ts`, which fails the request on any route it doesn't list. Without `mockApi`, every request fails as if offline (`test/setup.ts`).
- **Sync in tests:** a signed-in screen syncs as it would on a device, so add `...syncApi` (pushes apply, pulls bring nothing) to `mockApi` in tests that need the account's data downloaded, e.g. one that lands on setup. A route's responder receives the request, e.g. `applyPush` answers each pushed row. To sync device databases with each other, use `fakeSyncServer()` (`test/helpers/sync-server.ts`), which applies the API's conflict rules, and `openDeviceDatabase()` (`test/helpers/database.ts`) for each device, then call `syncOnce(db)` (see `test/sync/engine.test.ts`).
- **Screens and navigation:** render the real route files with `renderRouter(routes, { initialUrl: '/' })` from `expo-router/testing-library`. Then check the route with `expect(screen).toHavePathname('/sign-in')`, so the tests cover the layout's sign-in and setup guards too. Reset the stores in `beforeEach`: `useAuth.setState({ status: 'restoring', session: null })` and `useLocalData.setState({ status: 'closed', userId: null, setupCompleted: false })`.
- **Native views:** `test/setup.ts` replaces Skia (`test/helpers/skia.tsx`) and `@expo/ui` (`test/helpers/expo-ui-*.tsx`) with plain views. A SwiftUI `Picker` renders its options as radio buttons, so pick one with `fireEvent.press(screen.getByText('European Union'))`. A Compose `DropdownMenu` shows its items only while expanded.
- **Dates:** numbers that depend on today need a fixed clock. Fake only `Date` with `jest.useFakeTimers({ now, doNotFake: [...] })`, listing every timer, so the router and `findBy*` still run on real timers (see `test/app/index.test.tsx`). Fake every timer only to test the midnight rollover (`test/db/use-today.test.tsx`).
- **FlashList** runs in tests with its own `jestSetup` (loaded in `test/setup.ts`) and is transformed by Jest (`transformIgnorePatterns`). It places rows by position, so after a change the tree order isn't the order on screen: check the order on first render, and only that a new row is shown after a change (see `test/app/index.test.tsx`).
- **Home numbers** each read as one screen-reader element, e.g. "Budget left: ¥106,000" (BR-NFR-07). Find them with `screen.getByLabelText('Budget left: ¥106,000')`.
- **Counting amounts** change at once in tests: `test/setup.ts` reports Reduce Motion as on, so a new amount can be read straight away. `test/components/counting-text.test.tsx` turns counting back on with fake timers.
- Reanimated runs in Jest through its resolver (`resolver` in the `jest` config), so animated components render without mocks.
- **Code that reads config when its module loads** (`EXPO_PUBLIC_*`, Expo Go, the platform), e.g. `src/auth/providers.ts`: set the env var, then load a fresh copy inside `jest.isolateModules` (see `test/auth/providers.test.ts`).
  - Replace `Platform.OS` and share mocks outside the isolated registry: `react-native` looks `Platform` up when it is used, and a lazy `import()` resolves after `isolateModules` returns.
  - `import()` works in Jest because `babel.config.js` turns it into `require` in the test env only.
