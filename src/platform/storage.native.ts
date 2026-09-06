import * as SecureStore from 'expo-secure-store';

// SecureStore only permits alphanumerics, periods, hyphens and underscores.
const storageKey = (key: string) => `seekertag.${Array.from(key).map(char => char.codePointAt(0)!.toString(16)).join('-')}`;

export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(storageKey(key)),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(storageKey(key), value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(storageKey(key)),
  expiresAt: async (_key: string): Promise<number | null> => null,
  // SecureStore does not enumerate existing keys. Legacy conversations are
  // indexed lazily when their original link is opened again.
  keys: async (_prefix: string): Promise<string[]> => [],
};

let sessionQueue: Promise<unknown> = Promise.resolve();
function sessionOperation<T>(task: () => Promise<T>): Promise<T> {
  const next = sessionQueue.catch(() => {}).then(task); sessionQueue = next; return next;
}
export const tokenStorage = {
  get: (key = 'owner') => sessionOperation(() => secureStorage.get(key)),
  set: (token: string, key = 'owner') => sessionOperation(() => secureStorage.set(key, token)),
  clear: (key = 'owner') => sessionOperation(() => secureStorage.remove(key)),
  clearIfMatches: (token: string, key = 'owner') => sessionOperation(async () => {
    if (await secureStorage.get(key) !== token) return false;
    await secureStorage.remove(key); return true;
  }),
};
