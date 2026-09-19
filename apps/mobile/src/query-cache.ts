import { QueryClient } from '@tanstack/react-query';

export function createAppQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: (attempt, error) => {
        const status = (error as Error & { status?: number }).status;
        return attempt < 1 && error.name !== 'AbortError' && (status === undefined || status >= 500);
      },
    },
    // Wallet prompts and writes must never be replayed automatically on reconnect.
    mutations: { retry: false, networkMode: 'always' },
  } });
}

export const queryClient = createAppQueryClient();
const scopes = new Map<string, string>();
let nextScope = 0;
let generation = 0;

function scopeFor(token?: string | null) {
  if (!token) return 'public';
  let scope = scopes.get(token);
  if (!scope) { scope = `session-${++nextScope}`; scopes.set(token, scope); }
  return scope;
}

// Session credentials never appear in query keys, diagnostics or persisted data.
export function apiQueryKey(token: string | null | undefined, path: string) {
  return ['api', scopeFor(token), path] as const;
}

export function resourceMatches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

export function mutationResources(path: string): readonly string[] {
  const route = path.split('?')[0];
  if (resourceMatches(route, '/categories')) return ['/categories', '/tags', '/reports', '/public/tags'];
  if (resourceMatches(route, '/reward-operations') || /^\/tags\/[^/]+\/reward(?:\/|$)/.test(route)) {
    return ['/tags', '/reports', '/finder/reports', '/finder/tags', '/notifications', '/public/tags', '/reward-operations', '/rewards/balance'];
  }
  if (resourceMatches(route, '/tags')) {
    return ['/tags', '/categories', '/reports', '/finder/reports', '/public/tags', '/rewards/balance'];
  }
  if (resourceMatches(route, '/reports') || resourceMatches(route, '/finder/reports') || /^\/public\/tags\/[^/]+\/reports$/.test(route)) {
    return ['/reports', '/finder/reports', '/finder/tags', '/notifications', '/tags', '/public/tags', '/rewards/balance'];
  }
  if (route === '/notifications/read') return ['/notifications'];
  if (route === '/auth/wallet/verify' || route === '/auth/oauth/exchange') return ['/auth/me', '/tags', '/rewards/config', '/rewards/balance'];
  return [];
}

type Invalidation = { pending: Set<string>; seen: Set<string>; promise: Promise<void> };
const invalidations = new Map<string, Invalidation>();

export function invalidateApiResources(token: string | null | undefined, prefixes: readonly string[], newWrite = false): Promise<void> {
  if (!prefixes.length) return Promise.resolve();
  const scope = scopeFor(token);
  const existing = invalidations.get(scope);
  if (existing) {
    for (const prefix of prefixes) if (newWrite || !existing.seen.has(prefix)) { existing.seen.add(prefix); existing.pending.add(prefix); }
    return existing.promise;
  }
  const started = generation;
  const job: Invalidation = { pending: new Set(prefixes), seen: new Set(prefixes), promise: Promise.resolve() };
  job.promise = Promise.resolve().then(async () => {
    while (job.pending.size && generation === started) {
      const batch = [...job.pending]; job.pending.clear();
      const predicate = (query: { queryKey: readonly unknown[] }) => {
        const [kind, owner, path] = query.queryKey;
        return kind === 'api' && typeof path === 'string' &&
          (owner === scope || path.startsWith('/public/tags/')) && batch.some(prefix => resourceMatches(path, prefix));
      };
      // An older read must not win the race against a completed mutation.
      await queryClient.cancelQueries({ predicate });
      if (generation !== started) return;
      await queryClient.invalidateQueries({ predicate, refetchType: 'active' }, { cancelRefetch: false });
    }
  }).finally(() => { if (invalidations.get(scope) === job) invalidations.delete(scope); });
  invalidations.set(scope, job);
  return job.promise;
}

export function invalidateApiMutation(token: string | null | undefined, path: string) {
  return invalidateApiResources(token, mutationResources(path), true);
}

export function resetApiCache() {
  generation++;
  invalidations.clear();
  queryClient.clear();
  scopes.clear();
}
