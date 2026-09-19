import { queryOptions } from '@tanstack/react-query';
import { api } from './api';
import { apiQueryKey } from './query-cache';

export { queryClient, apiQueryKey, invalidateApiResources, resetApiCache } from './query-cache';

export function apiQueryOptions<T>(path: string, token?: string | null) {
  return queryOptions({
    queryKey: apiQueryKey(token, path),
    queryFn: ({ signal }) => api<T>(path, token, undefined, 'GET', signal),
  });
}
