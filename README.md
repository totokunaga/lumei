# Lumei

Lumei shows how much you can spend today and still reach your saving target. You log each expense with an amount and a category, and Lumei recalculates your daily allowance and charts your progress over the saving period.

| Path        | Contents                                         |
|-------------|--------------------------------------------------|
| `frontend/` | Mobile app for iOS and Android (Expo / React Native) |
| `backend/`  | API server (Go, PostgreSQL)                      |
| `infra/`    | AWS infrastructure                               |
| `docs/`     | Business requirements and architecture docs      |

Start the backend first, then the mobile app, which calls the backend's API.

## Backend

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- [dotenvx](https://dotenvx.com/docs/install) (`brew install dotenvx/brew/dotenvx`), which loads `backend/.env.dev`
- [Go 1.27](https://go.dev/dl/), only for `make run`. Everything else runs in Docker.

### Start

```sh
cd backend
make up-d
```

This starts PostgreSQL, applies the database migrations, and starts the API with hot reload in the background.

| Service    | Address           |
|------------|-------------------|
| API        | `localhost:18080` |
| PostgreSQL | `localhost:15432` |

The API compiles when it starts, so it can take a few seconds to answer. Check that it's up:

```sh
curl localhost:18080/health        # {"status":"ok"}
curl localhost:18080/health/full   # includes the database check
```

Other commands:

```sh
make logs   # Follow the container logs
make down   # Stop everything
make up     # Same as make up-d, but in the foreground
make run    # Run the API on your machine on localhost:8080 instead of in Docker (needs make up-d for the database)
make help   # Every command
```

## Mobile app

### Prerequisites

- [Bun](https://bun.sh/) (`brew install oven-sh/bun/bun`)
- To run on iOS: macOS with [Xcode](https://apps.apple.com/app/xcode/id497799835) and an iOS Simulator installed.
- To run on Android: [Android Studio](https://developer.android.com/studio) with an emulator (Android Virtual Device) set up.
- To run on your own phone instead: the [Expo Go](https://expo.dev/go) app.

### Start

```sh
cd frontend
bun install
bun run ios       # Opens the app in the iOS Simulator
bun run android   # Opens the app in the Android emulator
bun run start     # Starts the dev server only. Scan the QR code with Expo Go, or press i / a to pick a simulator.
```

The home screen shows `API status: ok` when the app can reach the backend.

### Point the app at the backend

The app calls `http://localhost:18080`, the API from `make up-d`, by default. To use a different address, create `frontend/.env.local` and restart the dev server:

| Where the app runs | `EXPO_PUBLIC_API_URL`                                 |
|--------------------|-------------------------------------------------------|
| iOS Simulator      | `http://localhost:18080` (the default)                |
| Android emulator   | `http://10.0.2.2:18080` (the emulator's name for your machine) |
| Your phone         | `http://<your computer's LAN IP>:18080` (phone and computer on the same Wi-Fi) |
| With `make run`    | Port `8080` instead of `18080`                        |

```sh
# frontend/.env.local
EXPO_PUBLIC_API_URL=http://10.0.2.2:18080
```

Run `bun run check` before you commit. It runs the type check, lint, and tests.

## More

- What the app does: [`docs/requirements/business-requirements.md`](docs/requirements/business-requirements.md)
- How it runs on AWS: [`docs/architecture/aws-infrastructure.md`](docs/architecture/aws-infrastructure.md)
- Commands and conventions for each part: [`frontend/CLAUDE.md`](frontend/CLAUDE.md) and [`backend/CLAUDE.md`](backend/CLAUDE.md)
