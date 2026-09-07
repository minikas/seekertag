/** Owner sessions stay in the tab; finder capabilities survive browser restarts for 30 days. */
const FINDER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const isFinderKey = (key: string) => key.startsWith('finder-') || key.startsWith('tag-chat-');

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    const name = `seekertag.${key}`;
    if (!isFinderKey(key)) {
      try { return globalThis.sessionStorage?.getItem(name) ?? null; }
      catch { return null; }
    }
    try {
      const serialized = globalThis.localStorage?.getItem(name);
      if (serialized !== null && serialized !== undefined) {
        try {
          const saved: unknown = JSON.parse(serialized);
          if (saved && typeof saved === 'object' && 'value' in saved && typeof saved.value === 'string' && 'expiresAt' in saved && typeof saved.expiresAt === 'number' && Number.isFinite(saved.expiresAt) && saved.expiresAt > Date.now()) return saved.value;
        } catch { /* Malformed or expired capability records are removed below. */ }
        try { globalThis.localStorage.removeItem(name); } catch {}
        try { globalThis.sessionStorage?.removeItem(name); } catch {}
        return null;
      }
    } catch { /* Existing session capabilities may still be readable. */ }
    try {
      const previous = globalThis.sessionStorage?.getItem(name) ?? null;
      if (previous !== null) {
        try { await secureStorage.set(key, previous); }
        catch { /* Preserve access in an old tab when persistent storage is blocked. */ }
      }
      return previous;
    }
    catch { return null; }
  },
  async set(key: string, value: string): Promise<void> {
    const name = `seekertag.${key}`;
    try {
      if (isFinderKey(key)) {
        globalThis.localStorage.setItem(name, JSON.stringify({ value, expiresAt: Date.now() + FINDER_TTL_MS }));
        try { globalThis.sessionStorage?.removeItem(name); } catch {}
      } else { globalThis.sessionStorage.setItem(name, value); }
    }
    catch { throw new Error('O navegador bloqueou o armazenamento. Permita os dados deste site para manter seu acesso.'); }
  },
  async remove(key: string): Promise<void> {
    try { globalThis.sessionStorage?.removeItem(`seekertag.${key}`); }
    catch { /* Continue so the persistent copy is removed when accessible. */ }
    if (isFinderKey(key)) {
      try { globalThis.localStorage?.removeItem(`seekertag.${key}`); }
      catch { /* A blocked store has no accessible capability to remove. */ }
    }
  },
};

export const tokenStorage = {
  get: (key = 'owner') => secureStorage.get(key),
  set: (token: string, key = 'owner') => secureStorage.set(key, token),
  clear: (key = 'owner') => secureStorage.remove(key),
};
