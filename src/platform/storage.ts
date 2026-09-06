/** Owner sessions stay in the tab; finder capabilities survive browser restarts for 30 days. */
const FINDER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const isFinderKey = (key: string) => key.startsWith('finder-') || key.startsWith('tag-chat-');
const isDurableKey = (key: string) => key.startsWith('mutation-') || key.startsWith('draft-') || key === 'saved-conversations-v1';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    const name = `seekertag.${key}`;
    if (isDurableKey(key)) {
      try { return globalThis.localStorage?.getItem(name) ?? null; }
      catch { throw new Error('O navegador bloqueou o armazenamento. Permita os dados deste site para recuperar seus envios.'); }
    }
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
      if (isDurableKey(key)) {
        globalThis.localStorage.setItem(name, value);
      } else if (isFinderKey(key)) {
        globalThis.localStorage.setItem(name, JSON.stringify({ value, expiresAt: Date.now() + FINDER_TTL_MS }));
        try { globalThis.sessionStorage?.removeItem(name); } catch {}
      } else { globalThis.sessionStorage.setItem(name, value); }
    }
    catch { throw new Error('O navegador bloqueou o armazenamento. Permita os dados deste site para manter seu acesso.'); }
  },
  async remove(key: string): Promise<void> {
    if (isDurableKey(key)) {
      try { globalThis.localStorage.removeItem(`seekertag.${key}`); return; }
      catch { throw new Error('Não foi possível remover o acesso salvo neste aparelho.'); }
    }
    try { globalThis.sessionStorage?.removeItem(`seekertag.${key}`); }
    catch { if (!isFinderKey(key)) throw new Error('Não foi possível remover a sessão salva neste aparelho.'); }
    if (isFinderKey(key)) {
      try { globalThis.localStorage?.removeItem(`seekertag.${key}`); }
      catch { throw new Error('Não foi possível remover o acesso salvo neste aparelho.'); }
    }
  },
  async expiresAt(key: string): Promise<number | null> {
    if (!isFinderKey(key)) return null;
    try { const value = JSON.parse(globalThis.localStorage.getItem(`seekertag.${key}`) || 'null'); return typeof value?.expiresAt === 'number' ? value.expiresAt : null; }
    catch { return null; }
  },
  async keys(prefix: string): Promise<string[]> {
    const names = new Set<string>();
    for (const kind of ['localStorage', 'sessionStorage'] as const) {
      try { const source = globalThis[kind]; for (let i = 0; i < source.length; i++) { const name = source.key(i); if (name?.startsWith(`seekertag.${prefix}`)) names.add(name.slice('seekertag.'.length)); } } catch {}
    }
    return [...names];
  },
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
