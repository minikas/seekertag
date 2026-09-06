import { secureStorage } from './platform/storage';
const queues = new Map<string, Promise<unknown>>();
export function saveDraft(scope: string, value: string): Promise<void> {
  const previous = queues.get(scope) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => value ? secureStorage.set(`draft-${scope}`, value) : secureStorage.remove(`draft-${scope}`));
  queues.set(scope, next);
  void next.finally(() => { if (queues.get(scope) === next) queues.delete(scope); }).catch(() => {});
  return next;
}
export async function loadDraft(scope: string): Promise<string | null> { await queues.get(scope)?.catch(() => {}); return secureStorage.get(`draft-${scope}`); }
