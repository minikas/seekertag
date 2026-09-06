import { forgetMutationScope } from './mutationStore.ts';

export type SavedConversation = { id: string; tagCode: string; tagName: string; updatedAt: string; status: string; expiresAt: number | null };
type FinderStorage = {
  get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>;
  expiresAt(key: string): Promise<number | null>; keys(prefix: string): Promise<string[]>;
};
const indexKey = 'saved-conversations-v1';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);

export function createFinderStore(storage: FinderStorage) {
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  function notify() { for (const listener of listeners) { try { listener(); } catch { /* UI subscribers cannot fail a durable save. */ } } }
  function serial<T>(task: () => Promise<T>): Promise<T> { const next = queue.catch(() => {}).then(task); queue = next; return next; }
  async function entries(): Promise<SavedConversation[]> {
    try { const parsed: unknown = JSON.parse(await storage.get(indexKey) || '[]'); return Array.isArray(parsed) ? parsed.filter(item => validId(item?.id) && validId(item?.tagCode) && typeof item?.tagName === 'string') : []; }
    catch { return []; }
  }
  async function remember(item: Omit<SavedConversation, 'expiresAt'>): Promise<void> {
    return serial(async () => {
      if (!validId(item.id) || !validId(item.tagCode) || !await storage.get(`finder-${item.id}`)) return;
      const list = await entries();
      const entry = { ...item, expiresAt: await storage.expiresAt(`finder-${item.id}`) };
      await storage.set(indexKey, JSON.stringify([entry, ...list.filter(previous => previous.id !== item.id)]));
      notify();
    });
  }
  return {
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    remember,
    async save(item: Omit<SavedConversation, 'expiresAt'>, token: string): Promise<void> {
      // Replaying an existing request must not silently renew its browser TTL.
      if (await storage.get(`finder-${item.id}`) !== token) await storage.set(`finder-${item.id}`, token);
      if (await storage.get(`tag-chat-${item.tagCode}`) !== item.id) await storage.set(`tag-chat-${item.tagCode}`, item.id);
      await remember(item);
    },
    async list(): Promise<SavedConversation[]> {
      const list = await entries();
      const valid: SavedConversation[] = [];
      for (const item of list) if ((item.expiresAt === null || item.expiresAt > Date.now()) && await storage.get(`finder-${item.id}`)) valid.push(item);
      return valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async legacyIds(): Promise<string[]> {
      const known = new Set((await entries()).map(item => item.id));
      return (await storage.keys('finder-')).map(key => key.slice('finder-'.length)).filter(id => validId(id) && !known.has(id));
    },
    remove(id: string): Promise<void> {
      return serial(async () => {
        const list = await entries(); const item = list.find(entry => entry.id === id);
        await storage.remove(`finder-${id}`);
        if (item && await storage.get(`tag-chat-${item.tagCode}`) === id) await storage.remove(`tag-chat-${item.tagCode}`);
        await forgetMutationScope(storage, `finder-message:${id}`);
        await storage.remove(`draft-finder-message:${id}`);
        await storage.set(indexKey, JSON.stringify(list.filter(entry => entry.id !== id)));
        notify();
      });
    },
  };
}
