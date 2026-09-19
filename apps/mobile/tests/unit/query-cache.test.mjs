import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryObserver } from '@tanstack/react-query';
import { apiQueryKey, createAppQueryClient, invalidateApiMutation, invalidateApiResources, queryClient, resetApiCache } from '../../src/query-cache.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => queryClient.setDefaultOptions({ ...queryClient.getDefaultOptions(), queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity } }));
afterEach(() => resetApiCache());

test('category changes refresh active items, stale inactive details, and isolate another account', async () => {
  const token = 'private-session-one';
  const key = apiQueryKey(token, '/tags');
  const detail = apiQueryKey(token, '/tags/item');
  const other = apiQueryKey('private-session-two', '/tags');
  queryClient.setQueryData(key, { category: 'Old' });
  queryClient.setQueryData(detail, { category: 'Old' });
  queryClient.setQueryData(other, { category: 'Other' });
  let reads = 0;
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: async () => { reads++; return { category: 'Renamed' }; } });
  const stop = observer.subscribe(() => {});
  await invalidateApiMutation(token, '/categories/category');
  assert.equal(queryClient.getQueryData(key).category, 'Renamed');
  assert.equal(reads, 1);
  assert.equal(queryClient.getQueryState(detail).isInvalidated, true);
  assert.equal(queryClient.getQueryState(other).isInvalidated, false);
  assert.equal(queryClient.getQueryData(other).category, 'Other');
  assert.ok(!JSON.stringify(key).includes(token));
  stop();
});

test('two writes during a refetch converge on the last write; explicit await does not duplicate reads', async () => {
  const token = 'session'; const key = apiQueryKey(token, '/tags');
  queryClient.setQueryData(key, { category: 'Original' });
  const first = deferred(); let reads = 0;
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: async () => {
    reads++; return reads === 1 ? first.promise : { category: 'Second write' };
  } });
  const stop = observer.subscribe(() => {});
  const one = invalidateApiMutation(token, '/categories/one');
  const join = invalidateApiResources(token, ['/categories', '/tags']);
  await tick(); assert.equal(reads, 1);
  const two = invalidateApiMutation(token, '/categories/two');
  first.resolve({ category: 'First write' });
  await Promise.all([one, two, join]);
  assert.equal(reads, 2);
  assert.equal(queryClient.getQueryData(key).category, 'Second write');
  stop();
});

test('mutation cancels an older read and session reset prevents late private data from returning', async () => {
  const token = 'session'; const key = apiQueryKey(token, '/tags');
  const oldRead = deferred(); let aborted = false; let reads = 0;
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: ({ signal }) => {
    reads++;
    if (reads > 1) return { category: 'Current' };
    signal.addEventListener('abort', () => { aborted = true; });
    return oldRead.promise;
  } });
  const stop = observer.subscribe(() => {});
  await tick(); await invalidateApiMutation(token, '/categories/category');
  assert.equal(aborted, true);
  assert.equal(queryClient.getQueryData(key).category, 'Current');
  resetApiCache(); oldRead.resolve({ category: 'Private old data' }); await tick();
  assert.equal(queryClient.getQueryData(key), undefined);
  assert.notDeepEqual(apiQueryKey(token, '/tags'), key);
  stop();
});

test('screens share one in-flight read and 429 errors are not retried', async () => {
  const client = createAppQueryClient(); const read = deferred(); let reads = 0;
  const options = { queryKey: ['shared'], queryFn: () => { reads++; return read.promise; } };
  const one = client.fetchQuery(options), two = client.fetchQuery(options);
  assert.equal(reads, 1); read.resolve('same');
  assert.deepEqual(await Promise.all([one, two]), ['same', 'same']);
  let attempts = 0;
  await assert.rejects(client.fetchQuery({ queryKey: ['limited'], queryFn: () => {
    attempts++; throw Object.assign(new Error('Too many attempts'), { status: 429 });
  } }));
  assert.equal(attempts, 1);
  assert.equal(client.getDefaultOptions().mutations.retry, false);
  client.clear();
});
