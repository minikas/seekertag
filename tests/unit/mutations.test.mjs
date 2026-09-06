import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutationStore, mutationBody } from '../../src/mutationStore.ts';
import { createFinderStore } from '../../src/finderStore.ts';

function memory() {
  const data = new Map(); const expirations = new Map();
  return { data, expirations, async get(key) { return data.get(key) ?? null; }, async set(key, value) { data.set(key, value); if (key.startsWith('finder-')) expirations.set(key, Date.now() + 100000); }, async remove(key) { data.delete(key); }, async expiresAt(key) { return expirations.get(key) ?? null; }, async keys(prefix) { return [...data.keys()].filter(key => key.startsWith(prefix)); } };
}
let nextKey = 0;
const randomKey = async () => (++nextKey).toString(16).padStart(64, '0');

test('a prepared request is durable before posting and resumes the exact intention after restart', async () => {
  const storage = memory();
  const original = await createMutationStore(storage, randomKey).prepare('message:owner:report', '/reports/report/messages', { body: 'Primeira mensagem' });
  assert.deepEqual(JSON.parse(await storage.get('mutation-message:owner:report')), original);
  const retry = await createMutationStore(storage, randomKey).prepare(original.scope, original.path, { body: 'Rascunho novo' });
  assert.deepEqual(retry, original);
  assert.deepEqual(mutationBody(retry), { body: 'Primeira mensagem', operationKey: original.operationKey });
});

test('failed persistence prevents a prepared operation and preserves an existing uncertain result', async () => {
  const storage = memory(); storage.set = async () => { throw new Error('disk full'); };
  await assert.rejects(createMutationStore(storage, randomKey).prepare('scope', '/reports', { body: 'oi' }), /disk full/);
  assert.equal(storage.data.size, 0);
  storage.data.set('mutation-scope', 'damaged record');
  await assert.rejects(createMutationStore(storage, randomKey).prepare('scope', '/reports', { body: 'oi' }), /recuperado/);
  assert.equal(storage.data.get('mutation-scope'), 'damaged record');
});

test('concurrent preparation serializes one intention; identical text after confirmation is a new operation', async () => {
  const storage = memory(); const store = createMutationStore(storage, randomKey);
  const [first, concurrent] = await Promise.all([store.prepare('scope', '/messages', { body: 'oi' }), store.prepare('scope', '/messages', { body: 'outra' })]);
  assert.equal(first.operationKey, concurrent.operationKey);
  await store.complete(first);
  const second = await store.prepare('scope', '/messages', { body: 'oi' });
  assert.notEqual(first.operationKey, second.operationKey);
  await store.complete(first);
  assert.equal((await store.load('scope')).operationKey, second.operationKey);
});

test('recovery operations persist their key without persisting passwords or accepting unrelated overrides', async () => {
  const storage = memory(); const store = createMutationStore(storage, randomKey);
  const pending = await store.prepare('recovery:owner', '/account/recovery-code', { password: 'synthetic-secret', note: 'safe' }, { sensitiveKeys: ['password'] });
  assert.equal([...storage.data.values()].some(value => value.includes('synthetic-secret')), false);
  assert.throws(() => mutationBody(pending), /Confirme novamente/);
  assert.deepEqual(mutationBody(pending, { password: 'resupplied', note: 'override' }), { password: 'resupplied', note: 'safe', operationKey: pending.operationKey });
});

test('invalid entropy cannot become an operation; scope cannot silently change endpoints', async () => {
  const storage = memory();
  await assert.rejects(createMutationStore(storage, async () => 'weak').prepare('scope', '/messages', {}), /envio seguro/);
  const store = createMutationStore(storage, randomKey);
  await store.prepare('scope', '/messages', {});
  await assert.rejects(store.prepare('scope', '/different', {}), /envio anterior/);
});

test('independent tabs keep both operations after either tab closes or completes first, without Web Locks', async () => {
  const storage = memory();
  const tabA = createMutationStore(storage, randomKey); const tabB = createMutationStore(storage, randomKey);
  const [a, b] = await Promise.all([
    tabA.prepare('finder-report:shared', '/public/tags/shared/reports', { message: 'A response may be lost' }),
    tabB.prepare('finder-report:shared', '/public/tags/shared/reports', { message: 'B is a separate intention' }),
  ]);
  assert.notEqual(a.operationKey, b.operationKey, 'two simultaneous intentions exist');
  assert.equal((await tabA.list(a.scope)).length, 2);
  assert.equal(JSON.parse(await storage.get(`mutation-${a.scope}`)).operationKey, b.operationKey, 'last-writer compatibility pointer does not own the ledger');
  await tabB.complete(b);
  const reopenedAfterBothTabsClose = createMutationStore(storage, randomKey);
  assert.deepEqual(await reopenedAfterBothTabsClose.load(a.scope), a, 'A keeps its exact retry key/body after B succeeds and both tabs close');
  assert.deepEqual(await reopenedAfterBothTabsClose.prepare(a.scope, a.path, { message: 'Another draft' }), a);
  await reopenedAfterBothTabsClose.complete(a);
  assert.deepEqual(await reopenedAfterBothTabsClose.list(a.scope), []);
  for (const value of [...storage.data.keys(), ...storage.data.values()]) {
    assert.equal(value.includes(a.operationKey), false); assert.equal(value.includes(b.operationKey), false);
    assert.equal(value.includes('response may be lost'), false);
  }
});

test('a late completion cannot erase a different tab operation even if its compatibility pointer races', async () => {
  const storage = memory(); const firstStore = createMutationStore(storage, randomKey);
  const a = await firstStore.prepare('scope', '/messages', { body: 'A' });
  const otherStore = createMutationStore(storage, randomKey); const originalGet = storage.get;
  let b; let interleave = true;
  storage.get = async key => {
    const snapshot = await originalGet(key);
    if (interleave && key === 'mutation-scope') {
      interleave = false;
      // A has durably completed, B now creates while A still holds an old
      // pointer snapshot. This used to let A delete B's only durable record.
      b = await otherStore.prepare('scope', '/messages', { body: 'B' });
    }
    return snapshot;
  };
  await firstStore.complete(a);
  assert.equal(await originalGet('mutation-scope'), null, 'the shared pointer can be removed by a stale tab');
  assert.deepEqual(await createMutationStore(storage, randomKey).load('scope'), b, 'per-operation record remains discoverable');
});

test('legacy pending records migrate without changing their key and stale legacy writes cannot resurrect completed operations', async () => {
  const storage = memory();
  const legacy = { scope: 'legacy:scope', path: '/messages', payload: { body: 'Legacy content' }, operationKey: await randomKey(), createdAt: Date.now(), sensitiveKeys: [] };
  await storage.set(`mutation-${legacy.scope}`, JSON.stringify(legacy));
  const store = createMutationStore(storage, randomKey);
  assert.deepEqual(await store.load(legacy.scope), legacy);
  assert.deepEqual(await store.prepare(legacy.scope, legacy.path, { body: 'New input' }), legacy);
  await store.complete(legacy);
  await storage.set(`mutation-${legacy.scope}`, JSON.stringify(legacy));
  assert.equal(await createMutationStore(storage, randomKey).load(legacy.scope), null);
  const next = await store.prepare(legacy.scope, legacy.path, { body: 'Next intention' });
  assert.notEqual(next.operationKey, legacy.operationKey);
  assert.equal((await store.load(legacy.scope)).payload.body, 'Next intention');
});

test('partial persistence and completion failures retain recoverable operation records', async () => {
  const storage = memory(); const write = storage.set; let failPointer = true;
  storage.set = async (key, value) => { if (key === 'mutation-scope' && failPointer) { failPointer = false; throw new Error('pointer quota'); } return write(key, value); };
  await assert.rejects(createMutationStore(storage, randomKey).prepare('scope', '/messages', { body: 'Saved before pointer failed' }), /pointer quota/);
  const recovered = await createMutationStore(storage, randomKey).load('scope');
  assert.equal(recovered.payload.body, 'Saved before pointer failed');
  const reopened = createMutationStore(storage, randomKey);
  assert.deepEqual(await reopened.prepare('scope', '/messages', { body: 'Another draft' }), recovered);
  storage.set = async (key, value) => { if (key.startsWith('mutation-done:')) throw new Error('marker quota'); return write(key, value); };
  await assert.rejects(reopened.complete(recovered), /marker quota/);
  assert.deepEqual(await reopened.load('scope'), recovered);
  storage.set = write; await reopened.complete(recovered);
  assert.equal(await reopened.load('scope'), null);
});

test('native storage without enumeration resumes its pointer after restart and cleans its record on completion', async () => {
  const storage = memory(); storage.keys = async () => [];
  const pending = await createMutationStore(storage, randomKey).prepare('native:scope', '/messages', { body: 'Native durable message' });
  const restarted = createMutationStore(storage, randomKey);
  assert.deepEqual(await restarted.load(pending.scope), pending);
  await restarted.complete(pending);
  assert.equal(await restarted.load(pending.scope), null);
  assert.equal([...storage.data.keys()].some(key => key.startsWith('mutation-ledger:')), false);
  assert.equal([...storage.data.values()].some(value => value.includes('Native durable message') || value.includes(pending.operationKey)), false);
});

const item = (id = 'report1', code = 'tag1') => ({ id, tagCode: code, tagName: 'Mochila', updatedAt: new Date().toISOString(), status: 'open' });
test('finder access automatically indexes metadata without renewing its individual expiry on replay', async () => {
  const storage = memory(); const store = createFinderStore(storage);
  await store.save(item(), 'finder-capability');
  storage.expirations.set('finder-report1', Date.now() + 5000);
  const expiry = await storage.expiresAt('finder-report1');
  await store.save({ ...item(), status: 'closed' }, 'finder-capability');
  const entries = await store.list();
  assert.equal(entries.length, 1); assert.equal(entries[0].status, 'closed'); assert.equal(entries[0].expiresAt, expiry);
  assert.equal(JSON.stringify(entries).includes('finder-capability'), false);
  assert.equal(await storage.get('tag-chat-tag1'), 'report1');
});

test('legacy finder keys are discoverable and migration preserves the capability', async () => {
  const storage = memory(); await storage.set('finder-report1', 'legacy-token');
  const store = createFinderStore(storage);
  assert.deepEqual(await store.legacyIds(), ['report1']);
  await store.remember(item());
  assert.deepEqual(await store.legacyIds(), []); assert.equal((await store.list()).length, 1);
  assert.equal(await storage.get('finder-report1'), 'legacy-token');
});

test('expired entries and removed access do not affect another conversation for the same tag', async () => {
  const storage = memory(); const store = createFinderStore(storage);
  await store.save(item(), 'first'); await store.save(item('report2'), 'second');
  storage.expirations.set('finder-report1', Date.now() - 1); await store.remember(item());
  assert.deepEqual((await store.list()).map(entry => entry.id), ['report2']);
  await store.remove('report1');
  assert.equal(await storage.get('finder-report1'), null);
  assert.equal(await storage.get('finder-report2'), 'second'); assert.equal(await storage.get('tag-chat-tag1'), 'report2');
});

test('failure while indexing does not destroy the saved capability or the recoverable operation', async () => {
  const storage = memory(); const write = storage.set;
  storage.set = async (key, value) => { if (key === 'saved-conversations-v1') throw new Error('quota'); await write(key, value); };
  const store = createFinderStore(storage);
  await assert.rejects(store.save(item(), 'finder-token'), /quota/);
  assert.equal(await storage.get('finder-report1'), 'finder-token');
  assert.deepEqual(await store.legacyIds(), ['report1']);
});

test('finder subscribers see durable late saves and removals and can unsubscribe', async () => {
  const storage = memory(); const store = createFinderStore(storage); let changes = 0;
  const off = store.subscribe(() => { assert.ok(storage.data.has('saved-conversations-v1')); changes++; });
  await store.save(item(), 'token'); assert.equal(changes, 1);
  await store.remove('report1'); assert.equal(changes, 2);
  off(); await store.save(item(), 'token'); assert.equal(changes, 2);
});

test('forgetting finder access purges every pending message record and draft on web and native while preserving other conversations', async () => {
  for (const native of [false, true]) {
    const storage = memory(); if (native) storage.keys = async () => [];
    const finder = createFinderStore(storage);
    await finder.save(item(), 'first-capability'); await finder.save(item('report2', 'tag2'), 'second-capability');
    const a = createMutationStore(storage, randomKey); const b = createMutationStore(storage, randomKey);
    const scopes = ['finder-message:report1', 'finder-message:report2'];
    const pending = native ? [await a.prepare(scopes[0], '/messages', { body: 'Forgotten message' })] : await Promise.all([a.prepare(scopes[0], '/messages', { body: 'Forgotten message A' }), b.prepare(scopes[0], '/messages', { body: 'Forgotten message B' })]);
    const keep = await a.prepare(scopes[1], '/messages', { body: 'Preserved message' });
    await storage.set(`draft-${scopes[0]}`, 'Forgotten draft');
    await finder.remove('report1');
    assert.equal(await storage.get('finder-report1'), null); assert.equal(await storage.get(`draft-${scopes[0]}`), null);
    assert.equal(await a.load(scopes[0]), null); assert.deepEqual(await a.load(scopes[1]), keep);
    assert.equal(await storage.get('finder-report2'), 'second-capability');
    for (const value of [...storage.data.keys(), ...storage.data.values()]) {
      assert.equal(value.includes('Forgotten'), false);
      for (const operation of pending) assert.equal(value.includes(operation.operationKey), false);
    }
  }
});
