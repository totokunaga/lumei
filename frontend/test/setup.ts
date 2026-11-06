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

// No test reaches the network: without `mockApi`, every request fails as if
// offline, so the sync engine stops quietly.
beforeEach(() =>
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.reject(new TypeError('Network request failed'))),
);

// The network listener the sync engine uses; tests call `syncOnce` or
// `requestSync` themselves.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// Gesture Handler's native module, replaced with its own Jest stand-ins. As
// it loads, it asks Worklets for the UI runtime, which Jest doesn't have.
require('react-native-gesture-handler/jestSetup');
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  getUIRuntimeHolder: () => ({}),
}));

// FlashList measures its views natively; its setup gives them fixed sizes.
require('@shopify/flash-list/jestSetup');

// Native views: Skia draws the region map, and @expo/ui the dropdowns. The
// stand-ins in test/helpers/ render plain views instead.
jest.mock('@shopify/react-native-skia', () => require('./helpers/skia'));
jest.mock('@expo/ui/swift-ui', () => require('./helpers/expo-ui-swift-ui'));
jest.mock('@expo/ui/swift-ui/modifiers', () => require('./helpers/expo-ui-swift-ui-modifiers'));
jest.mock('@expo/ui/jetpack-compose', () => require('./helpers/expo-ui-jetpack-compose'));

// Amounts change at once instead of counting, as with Reduce Motion on, so
// tests can read the new amount straight away. test/components/counting-text.test.tsx
// turns counting back on.
beforeEach(() =>
  jest.spyOn(require('@/components/motion'), 'useReduceMotion').mockReturnValue(true),
);
