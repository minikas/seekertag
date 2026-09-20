import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import { mutationResources } from '../../src/query-cache.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const compile = name => ts.transpileModule(readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const load = (source, dependencies) => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
};
const submissionSource = compile('reward-submission.ts');
const controllerSource = compile('useReward.ts');

test('reward writes invalidate operation, owner, finder and notification readers together', () => {
  for (const path of ['/tags/item/reward/prepare', '/reward-operations/operation/submit', '/reward-operations/operation/retry']) {
    const resources = mutationResources(path);
    for (const resource of ['/tags', '/reports', '/finder/reports', '/finder/tags', '/notifications', '/public/tags', '/reward-operations', '/rewards/balance']) {
      assert.ok(resources.includes(resource), `${path} must invalidate ${resource}`);
    }
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('overlapping sheets submit the same signed operation once and never retry a rejection implicitly', async () => {
  const calls = [], first = deferred();
  const { submitSignedRewardOperation: submit } = load(submissionSource, { './api': { api: (...args) => { calls.push(args); return first.promise; } } });
  const a = submit('session-a', 'operation', 'signed-bytes');
  const b = submit('session-a', 'operation', 'signed-bytes');
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  first.reject(new Error('Connection lost'));
  await assert.rejects(a, /Connection lost/);
  await tick();
  assert.equal(calls.length, 1);
  await assert.rejects(submit('session-a', 'operation', 'signed-bytes'), /Connection lost/);
  assert.equal(calls.length, 2, 'Only an explicit later call attempts recovery again');
});

test('signed submissions remain isolated between authentication scopes', async () => {
  const calls = [], pending = deferred();
  const { submitSignedRewardOperation: submit } = load(submissionSource, { './api': { api: (...args) => { calls.push(args); return pending.promise; } } });
  const a = submit('session-a', 'operation', 'signed-a');
  const b = submit('session-b', 'operation', 'signed-b');
  assert.notEqual(a, b);
  assert.deepEqual(calls.map(call => call.slice(1)), [['session-a', { transaction: 'signed-a' }], ['session-b', { transaction: 'signed-b' }]]);
  pending.resolve({ status: 'submitted', reward: null });
  await Promise.all([a, b]);
});

// Hook effects are exercised with real Query/Mutation observers. Only native
// wallet/storage APIs and React's small render scheduler are replaced.
function controllerHarness({ signed, status = 'prepared', expiresAt = Date.now() + 60_000, submitError, stateGate, storageGate, refreshFee, walletGate } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false, networkMode: 'always' } } });
  const slots = [], observers = [], requests = [], invalidations = [], signatures = [], changes = [], completions = [];
  let cursor = 0, effects = [], dirty = true, rendered, clock = 1;
  let props = { token: 'session-a', tagId: 'item', currency: 'SKR', onChanged: reward => changes.push(reward), onCompleted: () => completions.push(true) };
  const reward = { id: 'reserve', currency: 'SKR', amount: '1', status: 'reserved', operation: { id: 'operation', kind: 'fund', status } };
  const op = { id: 'operation', rewardId: 'reserve', currency: 'SKR', transaction: 'old-blockhash', feeLamports: '1', rentLamports: '2', spec: { kind: 'fund', amountUnits: '1000000', durationSeconds: 3600 } };
  const server = { state: { reward, payer: 'payer', config: { currencies: ['SKR'], network: 'devnet' } }, operation: { operation: op, status, reward } };
  const key = (token, path) => ['api', token, path];
  const api = async (path, token, body, method = body ? 'POST' : 'GET') => {
    requests.push({ path, token, body, method });
    if (path.endsWith('/reward') || path === '/rewards/config') { if (stateGate) await stateGate.promise; return structuredClone(server.state); }
    if (path === '/rewards/prices') return { expiresAt, fetchedAt: Date.now(), quotes: {} };
    if (path.startsWith('/rewards/balance')) return { currency: 'SKR', availableUnits: '10', network: 'devnet' };
    if (path === '/reward-operations/operation') return structuredClone(server.operation);
    if (path.endsWith('/refresh')) {
      if (server.operation.status === 'prepared') server.operation = { ...server.operation, operation: { ...server.operation.operation, transaction: 'fresh-blockhash', ...(refreshFee ? { feeLamports: refreshFee } : {}) } };
      return structuredClone(server.operation);
    }
    if (path.endsWith('/submit')) {
      if (submitError) throw new Error(submitError);
      server.operation = { ...server.operation, status: 'submitted' };
      server.state.reward = { ...server.state.reward, operation: { ...server.state.reward.operation, status: 'submitted' } };
      return { status: 'submitted', reward: structuredClone(server.state.reward) };
    }
    if (path.endsWith('/prepare')) { server.operation = { ...server.operation, status: 'prepared', operation: { ...op, transaction: 'new-preparation' } }; return { operation: server.operation.operation }; }
    assert.fail(`Unexpected API path ${path}`);
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))) slots[index] = { dependencies, callback };
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))) {
        const old = slots[index]; slots[index] = { dependencies };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const queryHooks = {
    useQuery(options) {
      const index = cursor++;
      if (!slots[index]) {
        const observer = new QueryObserver(client, options);
        slots[index] = observer;
        observers.push(observer.subscribe(() => { dirty = true; }));
      } else slots[index].setOptions(options);
      return slots[index].getCurrentResult();
    },
    useMutation(options) {
      const index = cursor++;
      if (!slots[index]) {
        const observer = new MutationObserver(client, options);
        slots[index] = observer;
        observers.push(observer.subscribe(() => { dirty = true; }));
      } else slots[index].setOptions(options);
      const observer = slots[index];
      return { ...observer.getCurrentResult(), mutateAsync: (variables, callbacks) => observer.mutate(variables, callbacks), mutate: (variables, callbacks) => { void observer.mutate(variables, callbacks).catch(() => {}); } };
    },
  };
  const identity = value => value;
  const submit = load(submissionSource, { './api': { api } }).submitSignedRewardOperation;
  const { useReward } = load(controllerSource, {
    react, '@tanstack/react-query': queryHooks, 'react-native': { Keyboard: { dismiss() {} }, ToastAndroid: { show() {}, LONG: 1, SHORT: 0 } },
    'expo-crypto': { digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'sha256' } },
    '@seekertag/shared/reward': { REWARD_DECIMALS: { SKR: 6 }, unitsToAmount: () => '1' },
    './api': { api }, './query': { queryClient: client, apiQueryKey: key, apiQueryOptions: (path, token) => ({ queryKey: key(token, path), queryFn: ({ signal }) => api(path, token, undefined, 'GET', signal) }), invalidateApiResources: async (token, paths) => { invalidations.push({ token, paths }); } },
    './ui': { useUI: () => ({ t: identity }) }, './reward.model': { validateRewardIntent() {} },
    './platform/reward-wallet': { signReward: async (operation, beforeSign) => {
      if (walletGate) await walletGate.promise;
      const ready = beforeSign ? await beforeSign() : operation;
      if (!ready) return null;
      signatures.push(ready); return 'newly-signed';
    } },
    './platform/storage': { secureStorage: { get: async () => { if (storageGate) await storageGate.promise; return signed; }, set: async (_, value) => { signed = value; }, remove: async () => { signed = undefined; } } },
    './reward-submission': { submitSignedRewardOperation: submit }, './i18n': { translateNotice: (_, value) => value },
  });
  const render = () => { cursor = 0; effects = []; dirty = false; rendered = useReward(props); const pending = effects; effects = []; pending.forEach(effect => effect()); return rendered; };
  return {
    client, server, requests, invalidations, signatures, changes, completions,
    get current() { return rendered; },
    get storedSignature() { return signed; },
    render,
    setProps(next) { props = { ...props, ...next }; dirty = true; },
    setOperation(next) { server.operation = next; client.setQueryData(key(props.token, '/reward-operations/operation'), next, { updatedAt: Date.now() + ++clock }); },
    async settle() {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (dirty) render();
        await tick();
        if (!dirty && !client.isFetching() && !client.isMutating()) return rendered;
      }
      assert.fail('Reward controller did not settle (possible cache update loop)');
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); observers.forEach(unsubscribe => unsubscribe()); client.clear(); },
  };
}

test('reward queries recover persisted signed bytes once without reopening the wallet', async t => {
  const h = controllerHarness({ signed: 'previously-signed' }); t.after(() => h.dispose());
  await h.settle();
  assert.equal(h.current.operation.status, 'submitted');
  assert.equal(h.signatures.length, 0);
  assert.deepEqual(h.requests.filter(request => request.method === 'POST').map(request => request.body), [{ transaction: 'previously-signed' }]);
  assert.ok(h.invalidations.some(({ paths }) => paths.includes('/tags') && paths.includes('/reports')));
  await h.settle();
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 1);
});

test('prepared unsigned reviews only sign on explicit approval and block a duplicate tap', async t => {
  const h = controllerHarness(); t.after(() => h.dispose());
  await h.settle();
  assert.equal(h.current.operation.status, 'prepared');
  assert.equal(h.signatures.length, 0);
  await Promise.all([h.current.approve(), h.current.approve()]);
  await h.settle();
  assert.equal(h.signatures.length, 1);
  assert.equal(h.signatures[0].transaction, 'fresh-blockhash');
  assert.equal(h.requests.filter(request => request.path.endsWith('/refresh')).length, 1);
  assert.equal(h.requests.filter(request => request.path.endsWith('/submit')).length, 1);
  assert.equal(h.current.operation.status, 'submitted');
});

test('wallet authorization finishes before renewing the blockhash, including expiry during authorization', async t => {
  const walletGate = deferred();
  const h = controllerHarness({ walletGate }); t.after(() => h.dispose());
  await h.settle();
  const pending = h.current.approve();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(h.requests.filter(request => request.path.endsWith('/refresh')).length, 0);
  assert.equal(h.signatures.length, 0);
  h.server.operation.status = 'expired';
  walletGate.resolve();
  await pending; await h.settle();
  assert.equal(h.signatures.length, 1);
  assert.equal(h.signatures[0].transaction, 'new-preparation');
  assert.equal(h.requests.filter(request => request.path.endsWith('/prepare')).length, 1);
  assert.equal(h.current.operation.status, 'submitted');
});

test('a fee change after wallet authorization requires another explicit review before signing', async t => {
  const h = controllerHarness({ refreshFee: '9' }); t.after(() => h.dispose());
  await h.settle(); await h.current.approve(); await h.settle();
  assert.equal(h.signatures.length, 0);
  assert.equal(h.requests.filter(request => request.path.endsWith('/submit')).length, 0);
  assert.equal(h.current.operation.operation.feeLamports, '9');
  assert.match(h.current.error, /As taxas mudaram/);
  await h.current.approve(); await h.settle();
  assert.equal(h.signatures.length, 1);
  assert.equal(h.current.operation.status, 'submitted');
});

test('expiry after signing preserves a retryable review and removes obsolete signed bytes', async t => {
  const message = 'A aprovação expirou antes da confirmação. Revise e assine novamente.';
  const h = controllerHarness({ submitError: message }); t.after(() => h.dispose());
  await h.settle(); await h.current.approve(); await h.settle();
  assert.equal(h.storedSignature, 'newly-signed');
  assert.equal(h.current.error, message);
  h.setOperation({ ...h.server.operation, status: 'expired' });
  await h.settle();
  assert.equal(h.current.operation.status, 'expired');
  assert.equal(h.storedSignature, undefined);
  assert.equal(h.signatures.length, 1, 'No automatic second signature');
  assert.equal(h.requests.filter(request => request.path.endsWith('/submit')).length, 1);
});

test('confirmation clears pending state, completes once and invalidates other reward views', async t => {
  const h = controllerHarness({ status: 'submitted', signed: 'signed' }); t.after(() => h.dispose());
  await h.settle();
  h.server.state.reward = { ...h.server.state.reward, operation: null };
  h.client.setQueryData(['api', 'session-a', '/tags/item/reward'], structuredClone(h.server.state));
  h.setOperation({ ...h.server.operation, status: 'confirmed', reward: h.server.state.reward });
  await h.settle();
  assert.equal(h.current.operation, undefined);
  assert.equal(h.completions.length, 1);
  assert.ok(h.invalidations.some(({ paths }) => paths.includes('/rewards/balance')));
  await h.settle();
  assert.equal(h.completions.length, 1);
});

test('failed automatic recovery keeps the lock and does not automatically retry the mutation', async t => {
  const h = controllerHarness({ signed: 'signed', submitError: 'Connection lost' }); t.after(() => h.dispose());
  await h.settle();
  assert.equal(h.current.operation.status, 'submitted');
  assert.equal(h.requests.filter(request => request.path.endsWith('/submit')).length, 1);
  assert.equal(h.signatures.length, 0);
  assert.match(h.current.error, /Connection lost/);
});

test('expired cached quotes are hidden while account balances use their payer and network scope', async t => {
  const h = controllerHarness({ expiresAt: Date.now() - 1 }); t.after(() => h.dispose());
  await h.settle();
  assert.equal(h.current.prices, undefined);
  const keys = h.client.getQueryCache().getAll().map(query => query.queryKey);
  assert.ok(keys.some(key => key[2] === '/rewards/balance?currency=SKR' && key[3] === 'payer' && key[4] === 'devnet'));
});


test('an identity change during signed recovery cannot submit for the previous account', async t => {
  const storageGate = deferred();
  const h = controllerHarness({ signed: 'old-account-signature', storageGate }); t.after(() => h.dispose());
  await h.settle();
  h.server.state.reward = null;
  h.setProps({ token: 'session-b' });
  await h.settle();
  storageGate.resolve();
  await tick(); await h.settle();
  assert.equal(h.current.operation, undefined);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(h.signatures.length, 0);
});

test('creating an item can prepare its deposit across the config to saved-item transition', async t => {
  const h = controllerHarness(); t.after(() => h.dispose());
  h.server.state.reward = null;
  h.setProps({ tagId: undefined });
  await h.settle();
  const pending = h.current.review('fund', { amount: '1', currency: 'SKR', durationSeconds: 3600 }, 'saved-item');
  h.setProps({ tagId: 'saved-item' });
  h.render();
  assert.equal(await pending, true);
  await h.settle();
  assert.equal(h.current.operation.status, 'prepared');
  assert.equal(h.requests.filter(request => request.path === '/tags/saved-item/reward/prepare').length, 1);
  assert.equal(h.signatures.length, 0);
});
