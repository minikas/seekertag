import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createPrivateKey, sign } from 'node:crypto';
import { Keypair, Transaction } from '@solana/web3.js';
import { createSignInMessage } from '@solana/wallet-standard-util';
import bs58 from 'bs58';
import { createApp } from '../../app.js';
import { createRewardChain } from '../../rewards/chain.js';
import { rpcHarness } from './rpc-harness.js';

function proof(wallet, payload) {
  const privateKey = createPrivateKey({ type: 'pkcs8', format: 'der', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.slice(0, 32))]) });
  const message = createSignInMessage({ ...payload, address: wallet.publicKey.toBase58() });
  return { address: wallet.publicKey.toBuffer().toString('base64'), signedMessage: Buffer.from(message).toString('base64'), signature: sign(null, message, privateKey).toString('base64') };
}

async function fixture(t) {
  const rpc = await rpcHarness();
  // Delay/reorder actual JSON-RPC responses around the production decoder and
  // SBF VM, including inspecting minContextSlot on the outgoing RPC request.
  const traffic = [];
  const proxy = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const call = JSON.parse(raw); traffic.push(call);
    const next = async () => (await fetch(rpc.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw })).json();
    const reply = rpc.intercept ? await rpc.intercept(call, next) : await next();
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reply));
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  rpc.chain = createRewardChain({ network: 'localnet', rpcUrl: `http://127.0.0.1:${proxy.address().port}`, verifier: rpc.verifier, treasury: rpc.treasury.publicKey.toBase58() });
  const app = createApp({ dbPath: ':memory:', publicUrl: 'https://seekertag.example', rateLimits: false, rewardChain: rpc.chain });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); await new Promise(resolve => proxy.close(resolve)); await rpc.close(); });
  async function request(path, token, body, method) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  async function account() {
    const wallet = Keypair.generate(); rpc.fund(wallet);
    const challenge = (await request('/auth/wallet/challenge', null, {})).data;
    const login = await request('/auth/wallet/verify', null, { challengeId: challenge.challengeId, ...proof(wallet, challenge.payload) });
    assert.equal(login.status, 200);
    return { wallet, ...login.data };
  }
  const owner = await account();
  const tagResult = await request('/tags', owner.token, { name: 'Reconciliation regression' });
  assert.equal(tagResult.status, 201); const tag = tagResult.data.tag;
  const db = app.locals.db;
  const prepare = (body = {}) => request(`/tags/${tag.id}/reward/prepare`, owner.token, { kind: 'fund', currency: 'SOL', amount: '0.02', durationSeconds: 3600, ...body });
  async function submit(operation) {
    const tx = Transaction.from(Buffer.from(operation.transaction, 'base64')); tx.partialSign(owner.wallet);
    return request(`/reward-operations/${operation.id}/submit`, owner.token, { transaction: tx.serialize().toString('base64') });
  }
  const state = () => request(`/tags/${tag.id}/reward`, owner.token);
  const operation = id => db.prepare('SELECT * FROM reward_operations WHERE id=?').get(id);
  const reward = () => db.prepare('SELECT * FROM rewards WHERE tag_id=? ORDER BY rowid DESC LIMIT 1').get(tag.id);
  async function fund() {
    const prepared = await prepare(); assert.equal(prepared.status, 201);
    assert.equal((await submit(prepared.data.operation)).status, 202);
    assert.equal((await state()).data.reward.status, 'reserved');
    return prepared.data.operation;
  }
  async function report() {
    const finder = await account();
    const result = await request(`/public/tags/${tag.code}/reports`, finder.token, { message: 'I found this object', finderName: 'Finder' });
    assert.equal(result.status, 201); const value = result.data;
    const base = `/finder/reports/${value.report.id}/reward/wallet`;
    const challenge = (await request(`${base}/challenge`, value.token, {})).data;
    assert.equal((await request(`${base}/verify`, value.token, { challengeId: challenge.challengeId, ...proof(finder.wallet, challenge.payload) })).status, 200);
    return { ...value, finder };
  }
  const reportState = id => db.prepare('SELECT status FROM reports WHERE id=?').get(id).status;
  const recoveryCount = () => db.prepare('SELECT recovery_count FROM tags WHERE id=?').get(tag.id).recovery_count;
  function incoming(path) {
    return new Promise(resolve => {
      const observe = req => { if (req.url === `/api${path}`) { server.off('request', observe); resolve(); } };
      server.on('request', observe);
    });
  }
  return { rpc, traffic, db, owner, tag, request, prepare, submit, state, operation, reward, fund, report, reportState, recoveryCount, incoming };
}

function escrowRead(call, h) {
  return call.method === 'getAccountInfo' && call.params[0] === h.reward().escrow;
}

function finalizeAfterSnapshot(h, { barrierError = false, staleBarrier = false } = {}) {
  let snapshot;
  let injected = false;
  h.rpc.intercept = async (call, next) => {
    if (!escrowRead(call, h)) return next();
    if (call.params[1]?.minContextSlot !== undefined) {
      assert.equal(call.params[1].commitment, 'finalized');
      assert.equal(call.params[1].minContextSlot, 100);
      if (barrierError) return { jsonrpc: '2.0', id: call.id, error: { code: -32016, message: 'Minimum context slot has not been reached' } };
      if (staleBarrier) return { ...snapshot, id: call.id };
    }
    const reply = await next();
    if (!injected) { injected = true; snapshot = reply; h.rpc.finalize(); }
    return reply;
  };
}

test('receipt/account race cannot prepare a release for another report or leave the paid report open', async t => {
  const h = await fixture(t); await h.fund();
  const first = await h.report(); const second = await h.report();
  const release = (await h.prepare({ kind: 'release', reportId: first.report.id })).data.operation;
  h.rpc.holdFinality = true; assert.equal((await h.submit(release)).status, 202);
  finalizeAfterSnapshot(h);
  const other = await h.prepare({ kind: 'release', reportId: second.report.id });
  assert.equal(other.status, 409); assert.equal(other.data.code, 'REWARD_NOT_RESERVED');
  assert.equal(h.reward().status, 'released');
  assert.equal(h.reward().release_report_id, first.report.id);
  assert.equal(h.reward().release_wallet, first.finder.wallet.publicKey.toBase58());
  assert.equal(h.operation(release.id).status, 'confirmed');
  assert.equal(h.reportState(first.report.id), 'resolved');
  assert.equal(h.recoveryCount(), 1);
  assert.ok(h.traffic.some(call => escrowRead(call, h) && call.params[1]?.minContextSlot === 100));
  await Promise.all([h.state(), h.state(), h.state()]);
  assert.equal(h.recoveryCount(), 1);
});

for (const kind of ['fund', 'renew', 'refund']) test(`${kind}: receipt finalizing after an old snapshot persists the reflected account state`, async t => {
  const h = await fixture(t);
  if (kind !== 'fund') await h.fund();
  if (kind === 'refund') h.rpc.advance(3600);
  const before = h.reward()?.refund_after;
  const prepared = await h.prepare({ kind }); assert.equal(prepared.status, 201);
  h.rpc.holdFinality = true; assert.equal((await h.submit(prepared.data.operation)).status, 202);
  finalizeAfterSnapshot(h);
  const result = await h.state();
  assert.equal(result.data.reward.status, kind === 'refund' ? 'refunded' : 'reserved');
  assert.equal(result.data.reward.operation, null);
  assert.equal(h.operation(prepared.data.operation.id).status, 'confirmed');
  if (kind === 'renew') assert.equal(h.reward().refund_after, before + 3600);
});

for (const barrier of ['unavailable', 'inconsistent']) test(`an ${barrier} account at the receipt slot preserves the submitted lock until reconciliation succeeds`, async t => {
  const h = await fixture(t); await h.fund(); const finder = await h.report();
  const release = (await h.prepare({ kind: 'release', reportId: finder.report.id })).data.operation;
  h.rpc.holdFinality = true; await h.submit(release);
  finalizeAfterSnapshot(h, { barrierError: barrier === 'unavailable', staleBarrier: barrier === 'inconsistent' });
  assert.equal((await h.state()).data.reward.status, 'unverified');
  assert.equal(h.operation(release.id).status, 'submitted');
  assert.equal(h.reward().status, 'reserved'); assert.equal(h.reportState(finder.report.id), 'open');
  h.rpc.height = release.lastValidBlockHeight + 1;
  assert.equal((await h.prepare({ kind: 'release', reportId: finder.report.id })).status, 409);
  assert.equal(h.operation(release.id).status, 'submitted');
  h.rpc.intercept = null;
  assert.equal((await h.state()).data.reward.status, 'released');
  assert.equal(h.reportState(finder.report.id), 'resolved'); assert.equal(h.recoveryCount(), 1);
});

test('overlapping owner/finder reads reconcile one terminal transition and never restore an old reservation', async t => {
  const h = await fixture(t); await h.fund(); const finder = await h.report();
  const release = (await h.prepare({ kind: 'release', reportId: finder.report.id })).data.operation;
  h.rpc.holdFinality = true; await h.submit(release);
  const reached = Promise.withResolvers(); const resume = Promise.withResolvers();
  let reads = 0;
  h.rpc.intercept = async (call, next) => {
    if (!escrowRead(call, h)) return next();
    reads++;
    const reply = await next();
    if (reads === 1) { reached.resolve(); await resume.promise; h.rpc.finalize(); }
    return reply;
  };
  const ownerRead = h.state(); await reached.promise;
  const finderPath = `/finder/reports/${finder.report.id}/reward`;
  const incoming = h.incoming(finderPath);
  const finderRead = h.request(finderPath, finder.token);
  await incoming;
  resume.resolve();
  const results = await Promise.all([ownerRead, finderRead]);
  for (const result of results) assert.equal(result.data.reward.status, 'released');
  assert.equal(reads, 2, 'concurrent readers share the initial read and receipt-slot barrier');
  assert.equal(h.reward().status, 'released'); assert.equal(h.recoveryCount(), 1);
  assert.equal(h.operation(release.id).status, 'confirmed');
});

test('a finalized failed deposit is abandoned and never marked paid', async t => {
  const h = await fixture(t);
  const deposit = (await h.prepare()).data.operation;
  let signature;
  h.rpc.intercept = async (call, next) => {
    if (call.method === 'sendTransaction') {
      // A finalized transaction failure has no account effects.
      signature = bs58.encode(Transaction.from(Buffer.from(call.params[0], 'base64')).signature);
      return { jsonrpc: '2.0', id: call.id, result: signature };
    }
    if (call.method === 'getSignatureStatuses' && call.params[0][0] === signature) return { jsonrpc: '2.0', id: call.id, result: { context: { slot: 100 }, value: [{ slot: 100, confirmations: null, confirmationStatus: 'finalized', err: { InstructionError: [2, { Custom: 1 }] } }] } };
    return next();
  };
  await h.submit(deposit);
  assert.equal((await h.state()).data.reward, null);
  assert.equal(h.operation(deposit.id).status, 'failed');
  assert.equal(h.reward().status, 'abandoned'); assert.equal(h.reward().deposit_signature, null);
  assert.equal((await h.prepare()).status, 201);
});

test('an expired release remains reserved and allows another report only after the finalized expiry barrier', async t => {
  const h = await fixture(t); await h.fund(); const first = await h.report(); const second = await h.report();
  const release = (await h.prepare({ kind: 'release', reportId: first.report.id })).data.operation;
  h.rpc.height = release.lastValidBlockHeight + 1;
  const result = await h.prepare({ kind: 'release', reportId: second.report.id });
  assert.equal(result.status, 201); assert.equal(h.operation(release.id).status, 'expired');
  assert.equal(h.reward().status, 'reserved'); assert.equal(h.reward().release_report_id, second.report.id);
  assert.equal(h.reportState(first.report.id), 'open'); assert.equal(h.recoveryCount(), 0);
  assert.ok(h.traffic.some(call => escrowRead(call, h) && call.params[1]?.minContextSlot === 100));
});

test('release finality arriving during the expiry check settles the original report instead of expiring its operation', async t => {
  const h = await fixture(t); await h.fund(); const first = await h.report(); const second = await h.report();
  const release = (await h.prepare({ kind: 'release', reportId: first.report.id })).data.operation;
  h.rpc.holdFinality = true; await h.submit(release);
  h.rpc.height = release.lastValidBlockHeight + 1;
  h.rpc.onFinalityRead = () => h.rpc.finalize();
  assert.equal((await h.prepare({ kind: 'release', reportId: second.report.id })).status, 409);
  assert.equal(h.operation(release.id).status, 'confirmed');
  assert.equal(h.reward().status, 'released'); assert.equal(h.reward().release_report_id, first.report.id);
  assert.equal(h.reportState(first.report.id), 'resolved'); assert.equal(h.recoveryCount(), 1);
});

async function legacyCorruption(h) {
  await h.fund(); const first = await h.report(); const second = await h.report();
  const release = (await h.prepare({ kind: 'release', reportId: first.report.id })).data.operation;
  h.rpc.holdFinality = true; const submitted = await h.submit(release);
  // Persist exactly the old race: operation A confirmed from its receipt,
  // escrow row still reserved, and preparation B overwrites release metadata.
  h.db.prepare("UPDATE reward_operations SET status='confirmed' WHERE id=?").run(release.id);
  h.db.prepare('UPDATE rewards SET settlement_signature=? WHERE id=?').run(submitted.data.signature, release.rewardId);
  const other = await h.prepare({ kind: 'release', reportId: second.report.id });
  assert.equal(other.status, 201);
  h.rpc.finalize();
  return { first, second, release, other: other.data.operation, signature: submitted.data.signature };
}

test('a previously corrupted release association recovers from immutable operation specs and retires the obsolete preparation', async t => {
  const h = await fixture(t); const saved = await legacyCorruption(h);
  const result = await h.state();
  assert.equal(result.data.reward.status, 'released'); assert.equal(result.data.reward.operation, null);
  assert.equal(h.reward().release_report_id, saved.first.report.id);
  assert.equal(h.reward().release_wallet, saved.first.finder.wallet.publicKey.toBase58());
  assert.equal(h.reward().settlement_signature, saved.signature);
  assert.equal(h.operation(saved.other.id).status, 'failed');
  assert.equal(h.reportState(saved.first.report.id), 'resolved'); assert.equal(h.recoveryCount(), 1);
  assert.equal((await h.submit(saved.other)).status, 409);
  assert.equal((await h.request(`/tags/${h.tag.id}`, h.owner.token, { name: 'Recovered object' }, 'PATCH')).status, 200);
});

for (const invalid of ['reportHash', 'recipient', 'wallet-proof']) test(`corrupted metadata is not recovered using an unrelated ${invalid}`, async t => {
  const h = await fixture(t); const saved = await legacyCorruption(h);
  if (invalid === 'wallet-proof') h.db.prepare('UPDATE finder_reward_wallets SET address=? WHERE report_id=?').run(saved.second.finder.wallet.publicKey.toBase58(), saved.first.report.id);
  else {
    const spec = JSON.parse(h.operation(saved.release.id).spec);
    spec[invalid] = invalid === 'reportHash' ? '00'.repeat(32) : saved.second.finder.wallet.publicKey.toBase58();
    h.db.prepare('UPDATE reward_operations SET spec=? WHERE id=?').run(JSON.stringify(spec), saved.release.id);
  }
  assert.equal((await h.state()).data.reward.status, 'unverified');
  assert.equal(h.reward().status, 'reserved'); assert.equal(h.reportState(saved.first.report.id), 'open');
  assert.equal(h.recoveryCount(), 0);
});

test('a delayed renewal preparation rejects a stale expiry after another renewal completes', async t => {
  const h = await fixture(t); await h.fund(); const before = h.reward().refund_after;
  const reached = Promise.withResolvers(); const resume = Promise.withResolvers();
  let held = false;
  h.rpc.intercept = async (call, next) => {
    const result = await next();
    if (!held && call.method === 'getLatestBlockhash') { held = true; reached.resolve(); await resume.promise; }
    return result;
  };
  // B reviewed the old expiry but its prepare response is delayed by RPC.
  const preparingB = h.prepare({ kind: 'renew' }); await reached.promise;
  let opA;
  try {
    const resultA = await h.prepare({ kind: 'renew' }); assert.equal(resultA.status, 201);
    opA = resultA.data.operation;
    assert.equal((await h.submit(opA)).status, 202); await h.state();
    assert.equal(h.reward().refund_after, before + 3600);
  } finally { resume.resolve(); }
  // A fully finishes before B enters its insertion transaction.
  const resultB = await preparingB;
  assert.equal(resultB.status, 409); assert.equal(resultB.data.code, 'REWARD_CHANGED');
  assert.equal(h.operation(opA.id).status, 'confirmed');
  assert.equal(h.db.prepare("SELECT COUNT(*) AS n FROM reward_operations WHERE reward_id=? AND kind='renew'").get(opA.rewardId).n, 1);
  assert.equal(h.reward().refund_after, before + 3600);
  // A fresh review must start from the new expiry and actually send its renewal.
  const retry = await h.prepare({ kind: 'renew' }); assert.equal(retry.status, 201);
  const operation = retry.data.operation;
  assert.equal(operation.spec.previousRefundAfter, before + 3600);
  const sends = h.rpc.sends;
  assert.equal((await h.submit(operation)).status, 202); await h.state();
  assert.equal(h.rpc.sends, sends + 1);
  assert.equal(h.operation(operation.id).status, 'confirmed');
  assert.ok(h.operation(operation.id).signature);
  assert.equal(h.reward().refund_after, before + 7200);
});
