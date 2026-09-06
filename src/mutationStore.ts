import { sha256 } from '@noble/hashes/sha2.js';

export type MutationPayload = Record<string, unknown>;
export type PendingMutation<P extends MutationPayload = MutationPayload> = {
  scope: string; operationKey: string; path: string; payload: P; createdAt: number; sensitiveKeys: string[];
};
export type MutationStorage = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void>; keys?(prefix: string): Promise<string[]> };

const keyFor = (scope: string) => `mutation-${scope}`;
const ledgerPrefix = (scope: string) => `mutation-ledger:${encodeURIComponent(scope)}:`;
const operationId = (key: string) => Array.from(sha256(Uint8Array.from(key.match(/../g)!, byte => parseInt(byte, 16))), byte => byte.toString(16).padStart(2, '0')).join('');
const ledgerKey = (pending: PendingMutation) => `${ledgerPrefix(pending.scope)}${operationId(pending.operationKey)}`;
const doneKey = (pending: PendingMutation) => `mutation-done:${encodeURIComponent(pending.scope)}:${operationId(pending.operationKey)}`;

function parse<P extends MutationPayload>(value: string, scope: string): PendingMutation<P> {
  let parsed: PendingMutation<P>;
  try { parsed = JSON.parse(value); } catch { throw new Error('O envio salvo não pôde ser recuperado. Não envie novamente até recuperar os dados deste aparelho.'); }
  if (!parsed || parsed.scope !== scope || !/^[a-f0-9]{64}$/.test(parsed.operationKey) || typeof parsed.path !== 'string' || !parsed.path.startsWith('/') || !parsed.payload || typeof parsed.payload !== 'object' || Array.isArray(parsed.payload) || !Array.isArray(parsed.sensitiveKeys) || !parsed.sensitiveKeys.every(key => typeof key === 'string') || !Number.isFinite(parsed.createdAt)) throw new Error('O envio salvo está incompleto. Preserve os dados deste aparelho para recuperar o resultado.');
  return parsed;
}

async function records(storage: MutationStorage, scope: string): Promise<string[]> {
  return [...new Set([keyFor(scope), ...await storage.keys?.(ledgerPrefix(scope)) || []])];
}

// Explicitly forgetting a finder conversation also forgets its pending message
// records. Completion markers contain a digest, never the retry secret/body.
export async function forgetMutationScope(storage: MutationStorage, scope: string): Promise<void> {
  for (const key of await records(storage, scope)) {
    const value = await storage.get(key);
    if (value) {
      let pending: PendingMutation | null = null;
      try { pending = parse(value, scope); } catch { /* Explicit deletion may remove a damaged record. */ }
      if (pending) {
        await storage.set(doneKey(pending), String(Date.now()));
        // Native cannot enumerate: the compatibility pointer supplies this key.
        await storage.remove(ledgerKey(pending));
      }
    }
    await storage.remove(key);
  }
}

// A request is retained until both its server result and required local effects
// are safely handled. Network errors never authorize creating another intention.
export function createMutationStore(storage: MutationStorage, randomKey: () => Promise<string>) {
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(scope: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(scope) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(scope, next);
    void next.finally(() => { if (queues.get(scope) === next) queues.delete(scope); }).catch(() => {});
    return next;
  }
  async function list<P extends MutationPayload>(scope: string): Promise<PendingMutation<P>[]> {
    const pending = new Map<string, PendingMutation<P>>();
    for (const key of await records(storage, scope)) {
      const value = await storage.get(key);
      if (!value) continue;
      const parsed = parse<P>(value, scope);
      if (key !== keyFor(scope) && key !== ledgerKey(parsed)) throw new Error('O envio salvo está incompleto. Preserve os dados deste aparelho para recuperar o resultado.');
      if (await storage.get(doneKey(parsed)) !== null) continue;
      pending.set(parsed.operationKey, parsed);
    }
    return [...pending.values()].sort((a, b) => a.createdAt - b.createdAt || a.operationKey.localeCompare(b.operationKey));
  }
  async function load<P extends MutationPayload>(scope: string): Promise<PendingMutation<P> | null> { return (await list<P>(scope))[0] || null; }
  return {
    load, list,
    prepare<P extends MutationPayload>(scope: string, path: string, payload: P, options: { sensitiveKeys?: string[] } = {}): Promise<PendingMutation<P>> {
      return serial(scope, async () => {
        const existing = await load<P>(scope);
        if (existing) {
          if (existing.path !== path) throw new Error('Há um envio anterior para recuperar antes de continuar.');
          return existing;
        }
        const operationKey = await randomKey();
        if (!/^[a-f0-9]{64}$/.test(operationKey)) throw new Error('Não foi possível preparar um envio seguro.');
        const sensitiveKeys = options.sensitiveKeys || [];
        const safePayload = Object.fromEntries(Object.entries(payload).filter(([key]) => !sensitiveKeys.includes(key))) as P;
        const pending = { scope, path, payload: safePayload, operationKey, createdAt: Date.now(), sensitiveKeys };
        const serialized = JSON.stringify(pending);
        // Immutable per-operation records survive two tabs racing to update the
        // compatibility pointer. Both writes must succeed before any POST.
        // Web enumerates records even on HTTP without Web Locks. Native retains
        // the pointer because SecureStore does not support key enumeration.
        await storage.set(ledgerKey(pending), serialized);
        await storage.set(keyFor(scope), serialized);
        return pending;
      });
    },
    complete(pending: PendingMutation): Promise<void> {
      return serial(pending.scope, async () => {
        // Write a separate tombstone before deleting payloads. An old tab can
        // neither overwrite this marker nor resurrect a completed legacy key.
        // Markers have no TTL: deleting them while old tabs exist is unsafe.
        // They store only a SHA-256 digest + timestamp, not credentials/text.
        await storage.set(doneKey(pending), String(Date.now()));
        await storage.remove(ledgerKey(pending));
        const legacy = await storage.get(keyFor(pending.scope));
        if (legacy && parse(legacy, pending.scope).operationKey === pending.operationKey) await storage.remove(keyFor(pending.scope));
      });
    },
  };
}

export function mutationBody(pending: PendingMutation, sensitiveFields: MutationPayload = {}): MutationPayload {
  for (const key of pending.sensitiveKeys) if (!(key in sensitiveFields)) throw new Error('Confirme novamente os dados necessários para recuperar este envio.');
  return { ...pending.payload, ...Object.fromEntries(pending.sensitiveKeys.map(key => [key, sensitiveFields[key]])), operationKey: pending.operationKey };
}
