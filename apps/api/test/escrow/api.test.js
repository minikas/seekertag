import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPrivateKey, sign } from 'node:crypto';
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { createApp } from '../../app.js';
import { rpcHarness } from './rpc-harness.js';
import { tokenAddress } from '@seekertag/shared/escrow-wire';
import { MAINNET_MINTS } from '@seekertag/shared/reward';

function proof(wallet, payload) {
  const privateKey = createPrivateKey({ type: 'pkcs8', format: 'der', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.slice(0, 32))]) });
  const message = createSignInMessage({ ...payload, address: wallet.publicKey.toBase58() });
  return { address: wallet.publicKey.toBuffer().toString('base64'), signedMessage: Buffer.from(message).toString('base64'), signature: sign(null, message, privateKey).toString('base64') };
}
async function harness(t) {
  const rpc = await rpcHarness();
  const app = createApp({ dbPath: ':memory:', publicUrl: 'https://seekertag.example', rateLimits: false, rewardChain: rpc.chain });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); await rpc.close(); });
  async function request(path, token, body, method) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  async function account() {
    const wallet = Keypair.generate(); rpc.fund(wallet);
    const start = await request('/auth/wallet/challenge', null, {});
    const login = await request('/auth/wallet/verify', null, { challengeId: start.data.challengeId, ...proof(wallet, start.data.payload) });
    assert.equal(login.status, 200);
    return { wallet, ...login.data };
  }
  async function tag(owner) { const result = await request('/tags', owner.token, { name: 'Reward test object' }); assert.equal(result.status, 201); return result.data.tag; }
  async function prepare(owner, tag, body = {}) {
    return request(`/tags/${tag.id}/reward/prepare`, owner.token, { kind: 'fund', currency: 'SOL', amount: '0.02', days: 30, ...body });
  }
  async function submit(owner, operation, mutate = tx => tx) {
    const tx = mutate(Transaction.from(Buffer.from(operation.transaction, 'base64'))); tx.partialSign(owner.wallet);
    return request(`/reward-operations/${operation.id}/submit`, owner.token, { transaction: tx.serialize().toString('base64') });
  }
  const state = (owner, tag) => request(`/tags/${tag.id}/reward`, owner.token);
  return { rpc, app, request, account, tag, prepare, submit, state };
}

test('spendable balance leaves rent and fees in SOL and requires SOL for token deposits', async t => {
  const h = await harness(t); const owner = await h.account();
  const sol = (await h.request('/rewards/balance?currency=SOL', owner.token)).data;
  assert.ok(BigInt(sol.reserveLamports) > 25000n);
  assert.equal(BigInt(sol.fundableUnits) + BigInt(sol.reserveLamports), BigInt(sol.availableUnits));
  const tag = await h.tag(owner);
  const prepared = await h.prepare(owner, tag);
  assert.equal(BigInt(sol.reserveLamports), BigInt(prepared.data.operation.rentLamports) + BigInt(prepared.data.operation.feeLamports));
  for (const currency of ['USDC', 'SKR']) {
    const rich = await h.rpc.chain.balance(owner.wallet.publicKey.toBase58(), currency);
    assert.equal(rich.fundableUnits, rich.availableUnits);
    assert.ok(BigInt(rich.reserveLamports) > BigInt(sol.reserveLamports));
  }
  const poor = Keypair.generate(); h.rpc.fund(poor);
  h.rpc.svm.setAccount({ address: poor.publicKey.toBase58(), executable: false, programAddress: SystemProgram.programId.toBase58(), lamports: 10000n, data: new Uint8Array() });
  for (const currency of ['SOL', 'USDC', 'SKR']) {
    const balance = await h.rpc.chain.balance(poor.publicKey.toBase58(), currency);
    assert.ok(BigInt(balance.availableUnits) > 0n);
    assert.equal(balance.fundableUnits, '0');
  }
});

test('API checks balance, signs exactly the prepared deposit, and waits for on-chain finality', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  assert.equal((await h.request(`/tags/${tag.id}/reward/balance?currency=SOL`, owner.token)).data.availableUnits, '10000000000');
  const insufficient = await h.prepare(owner, tag, { amount: '999' }); assert.equal(insufficient.status, 409); assert.equal(insufficient.data.code, 'INSUFFICIENT_BALANCE');
  const prepared = await h.prepare(owner, tag); assert.equal(prepared.status, 201, JSON.stringify(prepared)); const op = prepared.data.operation;
  assert.equal(op.spec.computeBudget, 'fixed-v2');
  assert.equal(op.feeLamports, '25000'); // includes the reviewed 20,000-lamport priority fee
  assert.equal((await h.state(owner, tag)).data.reward.status, 'pending');
  h.rpc.holdFinality = true;
  const result = await h.submit(owner, op); assert.equal(result.status, 202, JSON.stringify(result));
  assert.equal((await h.state(owner, tag)).data.reward.status, 'pending');
  const publicPending = await h.request(`/public/tags/${tag.code}`); assert.equal(publicPending.data.tag.reward.status, 'pending');
  h.rpc.finalize();
  const funded = await h.state(owner, tag); assert.equal(funded.data.reward.status, 'reserved', JSON.stringify(funded));
  assert.equal(funded.data.reward.amount, '0.02'); assert.equal(funded.data.reward.signature, result.data.signature);
  assert.equal((await h.request(`/reward-operations/${op.id}`, owner.token)).data.status, 'confirmed');
  const balance = h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58());
  assert.equal((await h.submit(owner, op)).status, 200);
  assert.equal(h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58()), balance);
  h.rpc.offline = true;
  assert.equal((await h.request(`/public/tags/${tag.code}`)).data.tag.reward.status, 'unverified');
});

test('tampered transactions, foreign sessions, and overlapping deposits cannot debit funds', async t => {
  const h = await harness(t); const owner = await h.account(); const other = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  assert.equal((await h.request(`/reward-operations/${op.id}`, other.token)).status, 404);
  const before = h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58());
  const tampered = await h.submit(owner, op, tx => tx.add(SystemProgram.transfer({ fromPubkey: owner.wallet.publicKey, toPubkey: other.wallet.publicKey, lamports: 1_000_000 })));
  assert.equal(tampered.status, 409); assert.equal(h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58()), before); assert.equal(h.rpc.sends, 0);
  assert.equal((await h.prepare(owner, tag)).status, 409);
  h.rpc.height += 151;
  assert.equal((await h.state(owner, tag)).data.reward, null);
  const expired = await h.submit(owner, op);
  assert.equal(expired.status, 409);
  assert.equal(expired.data.code, 'REWARD_OPERATION_EXPIRED');
  assert.match(expired.data.error, /expirou antes da confirmação/);
  assert.equal((await h.prepare(owner, tag)).status, 201);
});

test('refresh extends only unsigned reviews, keeps intent, and rejects an obsolete signature', async t => {
  const h = await harness(t); const owner = await h.account(); const other = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  const before = h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58());
  assert.equal((await h.request(`/reward-operations/${op.id}/refresh`, other.token, {})).status, 404);
  h.rpc.height += 100;
  const result = await h.request(`/reward-operations/${op.id}/refresh`, owner.token, {});
  assert.equal(result.status, 200, JSON.stringify(result));
  const fresh = result.data.operation;
  assert.equal(fresh.id, op.id); assert.deepEqual(fresh.spec, op.spec);
  assert.equal(fresh.lastValidBlockHeight, op.lastValidBlockHeight + 100);
  assert.notEqual(fresh.transaction, op.transaction);
  assert.equal(h.rpc.sends, 0); assert.equal(h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58()), before);
  assert.equal((await h.submit(owner, op)).status, 409);
  assert.equal(h.rpc.sends, 0);
  h.rpc.holdFinality = true;
  assert.equal((await h.submit(owner, fresh)).status, 202);
  h.rpc.chain.prepare = () => { assert.fail('Must never re-sign a submitted/confirmed payment'); };
  const submitted = await h.request(`/reward-operations/${op.id}/refresh`, owner.token, {});
  assert.equal(submitted.data.status, 'submitted'); assert.equal(submitted.data.operation.transaction, fresh.transaction);
  h.rpc.finalize();
  const confirmed = await h.request(`/reward-operations/${op.id}/refresh`, owner.token, {});
  assert.equal(confirmed.data.status, 'confirmed'); assert.equal(h.rpc.sends, 1);
});

test('an overlapping submission prevents refresh from replacing accepted signed bytes', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  const prepare = h.rpc.chain.prepare;
  let resume, entered;
  const gate = new Promise(resolve => { resume = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  h.rpc.chain.prepare = async spec => { entered(); await gate; return prepare(spec); };
  const refreshing = h.request(`/reward-operations/${op.id}/refresh`, owner.token, {});
  await started;
  h.rpc.holdFinality = true;
  await h.submit(owner, op);
  const accepted = h.app.locals.db.prepare('SELECT signed_tx,signature FROM reward_operations WHERE id=?').get(op.id);
  resume();
  const refreshed = await refreshing;
  assert.equal(refreshed.status, 409); assert.equal(refreshed.data.code, 'REWARD_OPERATION_CHANGED');
  assert.deepEqual(h.app.locals.db.prepare('SELECT signed_tx,signature FROM reward_operations WHERE id=?').get(op.id), accepted);
  assert.equal(h.rpc.sends, 1);
});

test('a stale expiry read cannot expire a concurrently refreshed transaction or abandon its deposit', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  const prepare = h.rpc.chain.prepare, read = h.rpc.chain.read;
  let resumePrepare, preparing, resumeRead, reading;
  const prepareGate = new Promise(resolve => { resumePrepare = resolve; });
  const prepareStarted = new Promise(resolve => { preparing = resolve; });
  h.rpc.chain.prepare = async spec => { preparing(); await prepareGate; return prepare(spec); };
  const refreshing = h.request(`/reward-operations/${op.id}/refresh`, owner.token, {});
  await prepareStarted;
  const readGate = new Promise(resolve => { resumeRead = resolve; });
  const readStarted = new Promise(resolve => { reading = resolve; });
  h.rpc.chain.read = async (...args) => { reading(); await readGate; return read(...args); };
  h.rpc.height = op.lastValidBlockHeight + 1;
  const polling = h.state(owner, tag);
  await readStarted;
  resumePrepare();
  const fresh = await refreshing;
  assert.equal(fresh.status, 200);
  resumeRead(); await polling;
  assert.equal((await h.request(`/reward-operations/${op.id}`, owner.token)).data.status, 'prepared');
  assert.equal((await h.state(owner, tag)).data.reward.status, 'pending');
  assert.equal((await h.submit(owner, fresh.data.operation)).status, 202);
  assert.equal((await h.state(owner, tag)).data.reward.status, 'reserved');
});

test('submitted deposits and renewals lock every object edit until finality, including RPC outages', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const patch = body => h.request(`/tags/${tag.id}`, owner.token, body, 'PATCH');
  for (const kind of ['fund', 'renew']) {
    const op = (await h.prepare(owner, tag, { kind })).data.operation;
    assert.equal((await patch({ name: `Before ${kind}` })).status, 200);
    h.rpc.holdFinality = true;
    assert.equal((await h.submit(owner, op)).status, 202);
    for (const body of [{ name: 'Changed' }, { description: 'Changed' }, { publicMessage: 'Changed' }, { status: 'paused' }, { rewardAmount: 12 }]) {
      const blocked = await patch(body);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.data.code, 'REWARD_PENDING');
    }
    h.rpc.offline = true;
    const unverified = await h.state(owner, tag);
    assert.equal(unverified.data.reward.status, 'unverified');
    assert.equal(unverified.data.reward.operation.status, 'submitted');
    assert.equal((await patch({ name: 'Still blocked' })).data.code, 'REWARD_PENDING');
    h.rpc.offline = false; h.rpc.finalize();
    assert.equal((await h.state(owner, tag)).data.reward.operation, null);
    assert.equal((await patch({ name: `After ${kind}` })).status, 200);
    assert.equal((await patch({ rewardAmount: 12 })).data.code, 'REWARD_LOCKED');
  }
});

test('a dropped deposit only unlocks edits after finalized expiry proves it cannot land', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  h.rpc.chain.send = async () => { throw new Error('RPC did not accept the transaction'); };
  assert.equal((await h.submit(owner, op)).status, 202);
  h.rpc.height = op.lastValidBlockHeight + 1;
  const patch = () => h.request(`/tags/${tag.id}`, owner.token, { name: 'Editable again', rewardAmount: 0 }, 'PATCH');
  assert.equal((await patch()).data.code, 'REWARD_PENDING');
  assert.equal((await h.state(owner, tag)).data.reward, null);
  assert.equal((await patch()).status, 200);
  assert.equal(h.rpc.sends, 0);
});

test('finality arriving during expiry reconciliation cannot abandon an actual deposit', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  h.rpc.holdFinality = true; await h.submit(owner, op);
  h.rpc.height = op.lastValidBlockHeight + 1;
  h.rpc.onFinalityRead = () => h.rpc.finalize();
  const result = await h.state(owner, tag);
  assert.equal(result.data.reward.status, 'reserved');
  assert.equal((await h.prepare(owner, tag)).data.code, 'REWARD_LOCKED');
});

test('a lost RPC response retries the stored signature without a second debit', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  const send = h.rpc.chain.send;
  h.rpc.chain.send = async encoded => { await send(encoded); throw new Error('Response lost'); };
  const result = await h.submit(owner, op); assert.equal(result.status, 202);
  const balance = h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58());
  assert.equal((await h.request(`/reward-operations/${op.id}/retry`, owner.token, {})).data.status, 'confirmed');
  assert.equal(h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58()), balance);
  assert.equal(h.rpc.sends, 1);
});

test('status polling rebroadcasts a dropped send with the same signature and stops after confirmation', async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag)).data.operation;
  const send = h.rpc.chain.send; const payloads = [];
  h.rpc.chain.send = async encoded => {
    payloads.push(encoded);
    if (payloads.length === 1) throw new Error('First request dropped');
    return send(encoded);
  };
  assert.equal((await h.submit(owner, op)).status, 202);
  assert.equal((await h.state(owner, tag)).data.reward.operation.status, 'submitted');
  assert.equal(payloads.length, 1); // polling must not flood the RPC
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(5_001);
  await h.state(owner, tag);
  const confirmed = await h.state(owner, tag);
  assert.equal(confirmed.data.reward.status, 'reserved');
  assert.equal(payloads.length, 2); assert.equal(payloads[0], payloads[1]);
  assert.equal(h.rpc.sends, 1);
  const balance = h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58());
  t.mock.timers.tick(5_001); await h.state(owner, tag);
  assert.equal(payloads.length, 2);
  assert.equal(h.rpc.svm.getBalance(owner.wallet.publicKey.toBase58()), balance);
});

for (const currency of ['SOL', 'USDC', 'SKR']) test(`${currency}: funded reward renews, blocks edits/transfer, and refunds after renewed deadline`, async t => {
  const h = await harness(t); const owner = await h.account(); const other = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag, { currency })).data.operation;
  assert.equal((await h.submit(owner, op)).status, 202);
  const funded = (await h.state(owner, tag)).data.reward;
  assert.equal(funded.status, 'reserved');
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token, { rewardAmount: 10 }, 'PATCH')).status, 409);
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token, { name: 'Renamed item' }, 'PATCH')).status, 200);
  const challenge = (await h.request('/auth/wallet/challenge', owner.token, { mode: 'reauth' })).data;
  const authProof = (await h.request('/auth/wallet/verify', owner.token, { challengeId: challenge.challengeId, ...proof(owner.wallet, challenge.payload) })).data.proof;
  assert.equal((await h.request(`/tags/${tag.id}/transfer`, owner.token, { recipient: other.user.id, proof: authProof })).data.code, 'REWARD_LOCKED');
  assert.equal((await h.prepare(owner, tag, { kind: 'refund' })).status, 409);
  const renewal = await h.prepare(owner, tag, { kind: 'renew', days: 7 }); assert.equal(renewal.status, 201, JSON.stringify(renewal));
  assert.equal((await h.submit(owner, renewal.data.operation)).status, 202);
  const renewed = (await h.state(owner, tag)).data.reward;
  assert.equal(Date.parse(renewed.refundAfter) - Date.parse(funded.refundAfter), 7 * 86_400_000);
  h.rpc.advance(30 * 86_400);
  assert.equal((await h.prepare(owner, tag, { kind: 'refund' })).status, 409);
  h.rpc.advance(7 * 86_400);
  const refund = await h.prepare(owner, tag, { kind: 'refund' }); assert.equal(refund.status, 201, JSON.stringify(refund));
  assert.equal((await h.submit(owner, refund.data.operation)).status, 202);
  assert.equal((await h.state(owner, tag)).data.reward.status, 'refunded');
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token, { rewardAmount: 0 }, 'PATCH')).status, 200);
});

test('finder wallet proof is report-bound; confirmed payout resolves exactly one recovery', async t => {
  const h = await harness(t); const owner = await h.account(); const finder = await h.account(); const tag = await h.tag(owner);
  const op = (await h.prepare(owner, tag, { currency: 'USDC', amount: '12.25' })).data.operation; await h.submit(owner, op); await h.state(owner, tag);
  const report = (await h.request(`/public/tags/${tag.code}/reports`, finder.token, { message: 'Found your item', finderName: 'Finder' })).data;
  const base = `/finder/reports/${report.report.id}/reward/wallet`;
  assert.equal((await h.request(`/reports/${report.report.id}/resolve`, owner.token, {})).status, 409);
  assert.equal((await h.prepare(owner, tag, { kind: 'release', reportId: report.report.id })).data.code, 'FINDER_WALLET_REQUIRED');
  const challenge = (await h.request(`${base}/challenge`, report.token, { language: 'en' })).data;
  const another = (await h.request(`/public/tags/${tag.code}/reports`, null, { message: 'Another finder' })).data;
  assert.equal((await h.request(`/finder/reports/${another.report.id}/reward/wallet/verify`, another.token, { challengeId: challenge.challengeId, ...proof(finder.wallet, challenge.payload) })).status, 401);
  assert.equal((await h.request(`${base}/verify`, report.token, { challengeId: challenge.challengeId, ...proof(finder.wallet, { ...challenge.payload, nonce: 'wrongnonce12345678' }) })).status, 401);
  assert.equal((await h.request(`${base}/verify`, report.token, { challengeId: challenge.challengeId, ...proof(owner.wallet, challenge.payload) })).status, 403);
  const identity = { challengeId: challenge.challengeId, ...proof(finder.wallet, challenge.payload) };
  assert.equal((await h.request(`${base}/verify`, report.token, identity)).status, 200);
  assert.equal((await h.request(base, report.token, { address: finder.wallet.publicKey.toBase58() })).status, 200);
  assert.equal((await h.request(`/finder/reports/${report.report.id}/reward`, report.token)).data.recipientMethod, 'signature');
  assert.equal((await h.request(base, report.token, { address: Keypair.generate().publicKey.toBase58() })).status, 200);
  assert.equal((await h.request(base, report.token, { address: finder.wallet.publicKey.toBase58() })).status, 200);
  assert.equal((await h.request(`${base}/verify`, report.token, identity)).status, 401);
  const payout = await h.prepare(owner, tag, { kind: 'release', reportId: report.report.id }); assert.equal(payout.status, 201, JSON.stringify(payout));
  assert.equal(payout.data.operation.spec.recipient, finder.wallet.publicKey.toBase58());
  const renewed = await h.request(`/reward-operations/${payout.data.operation.id}/refresh`, owner.token, {});
  assert.equal(renewed.status, 200);
  assert.deepEqual(renewed.data.operation.spec, payout.data.operation.spec);
  assert.notEqual(renewed.data.operation.transaction, payout.data.operation.transaction);
  const partial = Transaction.from(Buffer.from(renewed.data.operation.transaction, 'base64'));
  assert.ok(partial.signatures.find(s => s.publicKey.equals(h.rpc.verifier.publicKey)).signature);
  h.rpc.holdFinality = true; await h.submit(owner, renewed.data.operation);
  assert.equal((await h.request(`/reports/${report.report.id}`, owner.token)).data.report.status, 'open');
  h.rpc.finalize();
  assert.equal((await h.state(owner, tag)).data.reward.status, 'released');
  assert.equal((await h.request(`/reports/${report.report.id}`, owner.token)).data.report.status, 'resolved');
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token)).data.tag.recoveryCount, 1);
  await h.state(owner, tag); await h.request(`/reports/${report.report.id}/resolve`, owner.token, {});
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token)).data.tag.recoveryCount, 1);
  assert.equal((await h.prepare(owner, tag, { kind: 'refund' })).status, 409);
});

for (const currency of ['SOL', 'USDC', 'SKR']) test(`an anonymous finder can receive ${currency} using only a pasted address`, async t => {
  const h = await harness(t); const owner = await h.account(); const tag = await h.tag(owner);
  const recipient = Keypair.generate().publicKey; // No finder account, wallet connection or recipient signature.
  const amount = currency === 'SOL' ? '0.02' : '12.25';
  const funding = (await h.prepare(owner, tag, { currency, amount })).data.operation;
  await h.submit(owner, funding); await h.state(owner, tag);
  const report = (await h.request(`/public/tags/${tag.code}/reports`, null, { message: 'Found your item' })).data;
  const other = (await h.request(`/public/tags/${tag.code}/reports`, null, { message: 'Another finder' })).data;
  const base = `/finder/reports/${report.report.id}/reward/wallet`;
  for (const token of [undefined, owner.token, other.token]) {
    assert.equal((await h.request(base, token, { address: recipient.toBase58() })).status, token ? 404 : 401);
  }
  for (const address of ['', null, 123, {}, '0'.repeat(44), '11111111111111111111111111111111', `${recipient.toBase58()}extra`]) {
    const invalid = await h.request(base, report.token, { address });
    assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'INVALID_WALLET_ADDRESS');
  }
  assert.equal((await h.request(base, report.token, { address: owner.wallet.publicKey.toBase58() })).status, 403);
  const sends = h.rpc.sends;
  const saved = await h.request(base, report.token, { address: ` \n${recipient.toBase58()} ` });
  assert.equal(saved.status, 200); assert.equal(saved.data.recipient, recipient.toBase58());
  assert.equal(h.rpc.sends, sends, 'saving an address cannot broadcast a payment');
  assert.equal((await h.state(owner, tag)).data.reward.status, 'reserved');
  assert.equal((await h.request(base, report.token, { address: recipient.toBase58() })).status, 200);
  assert.equal((await h.request(base, report.token, { address: Keypair.generate().publicKey.toBase58() })).status, 409);
  for (const [path, token] of [[`/reports/${report.report.id}/reward`, owner.token], [`/finder/reports/${report.report.id}/reward`, report.token]]) {
    const state = (await h.request(path, token)).data;
    assert.equal(state.recipient, recipient.toBase58()); assert.equal(state.recipientMethod, 'address');
  }
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM finder_wallet_challenges').get().n, 0);
  const release = await h.prepare(owner, tag, { kind: 'release', reportId: report.report.id });
  assert.equal(release.status, 201, JSON.stringify(release)); assert.equal(release.data.operation.spec.recipient, recipient.toBase58());
  assert.equal(Transaction.from(Buffer.from(release.data.operation.transaction, 'base64')).signatures.some(s => s.publicKey.equals(recipient)), false);
  assert.equal((await h.request(base, report.token, { address: Keypair.generate().publicKey.toBase58() })).status, 409);
  await h.submit(owner, release.data.operation);
  assert.equal((await h.state(owner, tag)).data.reward.status, 'released');
  const netAmount = currency === 'SOL' ? 19_000_000n : 11_637_500n;
  if (currency === 'SOL') assert.equal(h.rpc.svm.getBalance(recipient.toBase58()), netAmount);
  else assert.equal(Buffer.from(h.rpc.svm.getAccount(tokenAddress(recipient, new PublicKey(MAINNET_MINTS[currency])).toBase58()).data).readBigUInt64LE(64), netAmount);
  assert.equal((await h.request(`/reports/${report.report.id}`, owner.token)).data.report.status, 'resolved');
  assert.equal((await h.request(base, report.token, { address: recipient.toBase58() })).status, 409);
});

test('an unsolicited finder wallet cannot take or lock a reward away from the finder chosen by its owner', async t => {
  const h = await harness(t); const owner = await h.account(); const attacker = await h.account(); const tag = await h.tag(owner);
  const funding = (await h.prepare(owner, tag)).data.operation;
  await h.submit(owner, funding); await h.state(owner, tag);
  const unsolicited = (await h.request(`/public/tags/${tag.code}/reports`, attacker.token, { message: 'Unsolicited claim' })).data;
  const legitimate = (await h.request(`/public/tags/${tag.code}/reports`, null, { message: 'Actual finder' })).data;
  const recipient = Keypair.generate().publicKey.toBase58();
  const sends = h.rpc.sends;
  assert.equal((await h.request(`/finder/reports/${unsolicited.report.id}/reward/wallet`, unsolicited.token, { address: attacker.wallet.publicKey.toBase58() })).status, 200);
  assert.equal(h.rpc.sends, sends, 'Registering a wallet cannot send funds');
  assert.equal((await h.state(owner, tag)).data.reward.status, 'reserved');
  assert.equal(h.app.locals.db.prepare("SELECT COUNT(*) AS n FROM reward_operations WHERE kind='release'").get().n, 0);
  for (const [token, status] of [[unsolicited.token, 401], [attacker.token, 404]]) {
    assert.equal((await h.request(`/tags/${tag.id}/reward/prepare`, token, { kind: 'release', reportId: unsolicited.report.id })).status, status);
    assert.equal((await h.request(`/reports/${unsolicited.report.id}/resolve`, token, {})).status, status);
  }
  assert.equal((await h.request(`/finder/reports/${legitimate.report.id}/reward/wallet`, unsolicited.token, { address: attacker.wallet.publicKey.toBase58() })).status, 404);
  assert.equal((await h.request(`/finder/reports/${legitimate.report.id}/reward/wallet`, legitimate.token, { address: recipient })).status, 200);
  const release = await h.prepare(owner, tag, { kind: 'release', reportId: legitimate.report.id, recipient: attacker.wallet.publicKey.toBase58() });
  assert.equal(release.status, 201);
  assert.equal(release.data.operation.spec.recipient, recipient, 'Payout uses the selected conversation, never a client-supplied recipient');
  for (const [token, status] of [[unsolicited.token, 401], [attacker.token, 404]]) {
    assert.equal((await h.request(`/reward-operations/${release.data.operation.id}/submit`, token, { transaction: release.data.operation.transaction })).status, status);
  }
  assert.equal((await h.request(`/reward-operations/${release.data.operation.id}/submit`, owner.token, { transaction: release.data.operation.transaction })).status, 409, 'An owner session still needs the funding wallet signature');
  assert.equal(h.rpc.sends, sends);
  const attackerBalance = h.rpc.svm.getBalance(attacker.wallet.publicKey.toBase58());
  await h.submit(owner, release.data.operation);
  assert.equal((await h.state(owner, tag)).data.reward.status, 'released');
  assert.equal(h.rpc.svm.getBalance(recipient), 19_000_000n);
  assert.equal(h.rpc.svm.getBalance(attacker.wallet.publicKey.toBase58()), attackerBalance);
});

test('new object reward setup is authenticated and timed reservations preserve exact hours through renewal', async t => {
  const h = await harness(t); const owner = await h.account();
  assert.equal((await h.request('/rewards/config')).status, 401);
  assert.equal((await h.request('/rewards/balance?currency=SOL')).status, 401);
  const setup = await h.request('/rewards/config', owner.token);
  assert.equal(setup.data.config.minSeconds, 3_600); assert.equal(setup.data.config.maxSeconds, 5 * 365 * 86_400);
  assert.equal(setup.data.config.treasury, h.rpc.treasury.publicKey.toBase58()); assert.equal(setup.data.config.feeBps, 500);
  assert.deepEqual(setup.data.config.verifiers, [h.rpc.verifier.publicKey.toBase58()]);
  assert.equal(setup.data.payer, owner.wallet.publicKey.toBase58());
  assert.equal((await h.request('/rewards/balance?currency=SOL', owner.token)).data.availableUnits, '10000000000');
  const tag = await h.tag(owner);
  for (const durationSeconds of [0, 3_599, 3_600.5, '3600', 5 * 365 * 86_400 + 1]) {
    assert.equal((await h.prepare(owner, tag, { days: undefined, durationSeconds })).status, 400);
  }
  assert.equal((await h.prepare(owner, tag, { days: 30, durationSeconds: 3_600 })).status, 400);
  const prepared = await h.prepare(owner, tag, { days: undefined, durationSeconds: 7_200 });
  assert.equal(prepared.status, 201, JSON.stringify(prepared));
  assert.equal(prepared.data.operation.spec.durationSeconds, 7_200);
  await h.submit(owner, prepared.data.operation);
  const reserved = (await h.state(owner, tag)).data.reward;
  const renewal = await h.prepare(owner, tag, { kind: 'renew', days: undefined, durationSeconds: 3_600 });
  assert.equal(renewal.status, 201, JSON.stringify(renewal)); await h.submit(owner, renewal.data.operation);
  const renewed = (await h.state(owner, tag)).data.reward;
  assert.equal(Date.parse(renewed.refundAfter) - Date.parse(reserved.refundAfter), 3_600_000);
  assert.equal((await h.prepare(owner, tag, { kind: 'renew', days: undefined, durationSeconds: 5 * 365 * 86_400 })).status, 400);
});
