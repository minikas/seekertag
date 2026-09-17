import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPrivateKey, sign } from 'node:crypto';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { createApp } from '../../app.js';
import { rpcHarness } from './rpc-harness.js';

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
  assert.equal((await h.submit(owner, op)).status, 409);
  assert.equal((await h.prepare(owner, tag)).status, 201);
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
  assert.equal((await h.request(`${base}/verify`, report.token, identity)).status, 401);
  const payout = await h.prepare(owner, tag, { kind: 'release', reportId: report.report.id }); assert.equal(payout.status, 201, JSON.stringify(payout));
  assert.equal(payout.data.operation.spec.recipient, finder.wallet.publicKey.toBase58());
  h.rpc.holdFinality = true; await h.submit(owner, payout.data.operation);
  assert.equal((await h.request(`/reports/${report.report.id}`, owner.token)).data.report.status, 'open');
  h.rpc.finalize();
  assert.equal((await h.state(owner, tag)).data.reward.status, 'released');
  assert.equal((await h.request(`/reports/${report.report.id}`, owner.token)).data.report.status, 'resolved');
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token)).data.tag.recoveryCount, 1);
  await h.state(owner, tag); await h.request(`/reports/${report.report.id}/resolve`, owner.token, {});
  assert.equal((await h.request(`/tags/${tag.id}`, owner.token)).data.tag.recoveryCount, 1);
  assert.equal((await h.prepare(owner, tag, { kind: 'refund' })).status, 409);
});

test('new object reward setup is authenticated and timed reservations preserve exact hours through renewal', async t => {
  const h = await harness(t); const owner = await h.account();
  assert.equal((await h.request('/rewards/config')).status, 401);
  assert.equal((await h.request('/rewards/balance?currency=SOL')).status, 401);
  const setup = await h.request('/rewards/config', owner.token);
  assert.equal(setup.data.config.minSeconds, 3_600); assert.equal(setup.data.config.maxSeconds, 5 * 365 * 86_400);
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
