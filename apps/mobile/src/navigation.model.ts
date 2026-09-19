export type NavigationEntry = { id: number; path: readonly number[]; task: boolean; back: () => void };

// A descendant belongs above its parent. A newer sibling belongs above the
// entire older subtree, regardless of React's child-first effect ordering.
export function compareNavigationPaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function createNavigationStore() {
  const entries = new Map<number, NavigationEntry>();
  const returnFocus = new Map<number, number>();
  const listeners = new Set<() => void>();
  let snapshot = { top: 0, tasks: 0 };
  const publish = () => {
    const ordered = [...entries.values()].sort((a, b) => compareNavigationPaths(a.path, b.path));
    snapshot = { top: ordered.at(-1)?.id || 0, tasks: ordered.filter(entry => entry.task).length };
    listeners.forEach(listener => listener());
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    register(entry: NavigationEntry) { entries.set(entry.id, entry); publish(); return () => { entries.delete(entry.id); returnFocus.delete(entry.id); publish(); }; },
    rememberFocus(target: number) { returnFocus.set(snapshot.top, target); },
    focusTarget: (id: number) => returnFocus.get(id),
    back() { const entry = entries.get(snapshot.top); if (!entry) return false; entry.back(); return true; },
  };
}

// Session-scoped drafts stay outside individual conversation mounts. No token
// or message is written to disk, and a new authenticated session gets a new map.
export class ConversationDrafts {
  private drafts = new Map<string, string>();
  get(id: string) { return this.drafts.get(id) || ''; }
  set(id: string, text: string) { if (text) this.drafts.set(id, text); else this.drafts.delete(id); }
  clear() { this.drafts.clear(); }
}
