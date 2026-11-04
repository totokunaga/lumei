// Runs before every test file (`setupFilesAfterEnv` in package.json).

// An in-memory secure store, emptied before each test, so the auth store can
// save and restore sessions. Tests read it through expo-secure-store itself.
const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockSecureStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockSecureStore.delete(key)),
}));
beforeEach(() => mockSecureStore.clear());

// Account databases run on sql.js in memory (test/helpers/database.ts),
// emptied before each test.
jest.mock('@/db/client', () => require('./helpers/database'));
beforeEach(() => require('./helpers/database').resetDatabases());

// Random bytes for record IDs come from Node instead of the native module.
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)),
}));

// The device-wide key-value store (the chosen language) is an in-memory map,
// emptied before each test.
const mockKvStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: jest.fn((key: string) => mockKvStore.get(key) ?? null),
    setItemSync: jest.fn((key: string, value: string) => void mockKvStore.set(key, value)),
  },
}));
beforeEach(() => mockKvStore.clear());
