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
