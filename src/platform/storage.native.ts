import * as SecureStore from 'expo-secure-store';

// SecureStore only permits alphanumerics, periods, hyphens and underscores.
const storageKey = (key: string) => `seekertag.${Array.from(key).map(char => char.codePointAt(0)!.toString(16)).join('-')}`;

export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(storageKey(key)),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(storageKey(key), value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(storageKey(key)),
};

export const tokenStorage = {
  get: (key = 'owner') => secureStorage.get(key),
  set: (token: string, key = 'owner') => secureStorage.set(key, token),
  clear: (key = 'owner') => secureStorage.remove(key),
};
