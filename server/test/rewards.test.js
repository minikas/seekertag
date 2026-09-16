// These exercise API trust boundaries against an explicitly simulated RPC.
// Actual program execution/token movement is covered by tests/rewards/*.localnet.*.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPrivateKey, sign } from 'node:crypto';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { deriveRewardAddresses } from '../../shared/reward-protocol.mjs';
import { createApp } from '../app.js';

const clock = () => Math.floor(Date.now() / 1000);
function simulatedRpc() {
  const programId = Keypair.generate().publicKey; const mint = Keypair.generate().publicKey;
  const genesisHash = 'simulated-genesis-for-api-tests';
  const state = { blockHeight: 100, slot: 1000, error: false, accounts: new Map(), transactions: new Map() };
  const mintData = Buffer.alloc(82);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 1_000_000_000_000n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  state.program = { executable: true, owner: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'), data: Buffer.alloc(0), lamports: 1 };
  state.mint = { executable: false, owner: TOKEN_PROGRAM_ID, data: mintData, lamports: 1 };
  const check = () => { if (state.error) throw new Error('simulated RPC outage with private credential that must not leak'); };
  const account = (key) => key.equals(programId) ? state.program : key.equals(mint) ? state.mint : state.accounts.get(key.toBase58()) || null;
  const connection = {
    async getGenesisHash() { check(); return state.genesisHash || genesisHash; },
    async getMultipleAccountsInfo(keys) { check(); return keys.map(account); },
    async getEpochInfo() { check(); if (state.beforeEpoch) await state.beforeEpoch(); return { absoluteSlot: state.slot, blockHeight: state.blockHeight }; },
    async getMultipleAccountsInfoAndContext(keys) { check(); const snapshot = { context: { slot: state.slot }, value: keys.map(account) }; if (state.afterSnapshot) await state.afterSnapshot(); return snapshot; },
    async getLatestBlockhash() { check(); return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: state.blockHeight + 150 }; },
    async getTransaction(signature) { check(); return state.transactions.get(signature) || null; },
  };
  const env = { SKR_REWARDS_ENABLED: 'true', SKR_CLUSTER: 'localnet', SKR_RPC_URL: 'http://localhost:8899/private-test-rpc-key', SKR_PROGRAM_ID: programId.toBase58(), SKR_MINT: mint.toBase58(), SKR_GENESIS_HASH: genesisHash };
  function writeReceipt(row, { status = 'funded', expiry = row.expires_at, recipient = null, reportRef = null, balance = BigInt(row.amount_units), createdAt = clock() - 1000, claimSeq = ['committed', 'paid'].includes(status) ? 1n : BigInt(row.claim_seq || 0), committedAt = ['committed', 'paid'].includes(status) ? (row.committed_at || clock() - 1) : 0 } = {}) {
    const addresses = deriveRewardAddresses(programId, row.wallet, Buffer.from(row.reference, 'hex'));
    const data = Buffer.alloc(224); data.write('SKREWRD2'); data[8] = 2; data[9] = { funded: 1, paid: 2, refunded: 3, committed: 4 }[status]; data[10] = addresses.rewardBump; data[11] = addresses.vaultBump; data[12] = 6;
    new PublicKey(row.wallet).toBuffer().copy(data, 16); mint.toBuffer().copy(data, 48); Buffer.from(row.reference, 'hex').copy(data, 80);
    data.writeBigUInt64LE(BigInt(row.amount_units), 112); data.writeBigInt64LE(BigInt(expiry), 120);
    if (recipient) new PublicKey(recipient).toBuffer().copy(data, 128); if (reportRef) Buffer.from(reportRef, 'hex').copy(data, 160);
    data.writeBigInt64LE(BigInt(createdAt), 192); data.writeBigInt64LE(['funded', 'committed'].includes(status) ? 0n : BigInt(clock()), 200);
    data.writeBigUInt64LE(BigInt(claimSeq), 208); data.writeBigInt64LE(BigInt(committedAt), 216);
    const vault = Buffer.alloc(165);
    AccountLayout.encode({ mint, owner: addresses.reward, amount: balance, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, vault);
    state.accounts.set(addresses.reward.toBase58(), { data, owner: programId, executable: false, lamports: 1 });
    state.accounts.set(addresses.vault.toBase58(), { data: vault, owner: TOKEN_PROGRAM_ID, executable: false, lamports: 1 });
  }
  return { env, state, connection, writeReceipt };
}

async function harness({ disabled = false, dbPath = ':memory:' } = {}) {
  const rpc = simulatedRpc();
  const app = createApp({ dbPath, rateLimits: false, rewards: { env: disabled ? {} : rpc.env, connection: rpc.connection } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  let count = 0;
  async function register() { const r = await request('/auth/register', { body: { name: 'Reward tester', email: `test${++count}@example.com`, password: 'correct horse battery' } }); assert.equal(r.status, 201); return r.data; }
  const owner = await register(); const ownerWallet = Keypair.generate();
  const tagResult = await request('/tags', { token: owner.token, body: { name: 'Backpack' } }); const tag = tagResult.data.tag;
  async function report() { const r = await request(`/public/tags/${tag.code}/reports`, { body: { finderName: 'Finder', message: 'I found this backpack.' } }); assert.equal(r.status, 201); return r.data; }
  const endpoint = `/tags/${tag.id}/reward`;
  const row = () => app.locals.db.prepare('SELECT * FROM rewards ORDER BY rowid DESC LIMIT 1').get();
  const prepare = (body = {}) => request(`${endpoint}/prepare`, { token: owner.token, body: { wallet: ownerWallet.publicKey.toBase58(), amount: '10.000001', days: 7, ...body } });
  const sync = (body = {}) => request(`${endpoint}/sync`, { token: owner.token, body });
  async function fund() { const prepared = await prepare(); assert.equal(prepared.status, 200, JSON.stringify(prepared.data)); rpc.writeReceipt(row()); const synced = await sync(); assert.equal(synced.data.reward.status, 'funded', JSON.stringify(synced.data)); return prepared.data; }
  async function proof(found, pair = Keypair.generate()) {
    const wallet = pair.publicKey.toBase58(); const prefix = `/finder/reports/${found.report.id}/reward/wallet`;
    const challenge = await request(`${prefix}/challenge`, { token: found.token, body: { wallet } }); assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(pair.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
    const body = { wallet, nonce: challenge.data.nonce, signature: sign(null, Buffer.from(challenge.data.message), key).toString('base64') };
    return { prefix, body, pair, challenge: challenge.data };
  }
  return { app, rpc, owner, ownerWallet, tag, request, register, report, endpoint, row, prepare, sync, fund, proof, close: async () => { await new Promise((resolve) => server.close(resolve)); app.locals.close(); } };
}

test('escrow is disabled by default and all private endpoints preserve owner/finder authorization', async (t) => {
  const h = await harness({ disabled: true }); t.after(h.close);
  const config = await h.request('/rewards/config'); assert.equal(config.data.enabled, false); assert.ok(!JSON.stringify(config).includes('rpc'));
  assert.equal((await h.prepare()).status, 503);
  const stranger = await h.register(); const found = await h.report();
  for (const action of ['', '/sync', '/prepare', '/renew', '/refund', '/cancel']) {
    const method = action ? 'POST' : 'GET';
    assert.equal((await h.request(h.endpoint + action, { method, body: action ? {} : undefined })).status, 401);
    assert.equal((await h.request(h.endpoint + action, { method, token: stranger.token, body: action ? {} : undefined })).status, 404);
  }
  assert.equal((await h.request(`/reports/${found.report.id}/reward`, { token: stranger.token })).status, 404);
  assert.equal((await h.request(`/reports/${found.report.id}/reward/release`, { token: stranger.token, body: {} })).status, 404);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/reward`, { token: h.owner.token })).status, 404);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/reward/wallet/challenge`, { token: h.owner.token, body: {} })).status, 404);
  assert.deepEqual((await h.request(`/public/tags/${h.tag.code}/reward`)).data, { reward: null });
});

test('network, mint and executable program are verified before any preparation', async (t) => {
  const h = await harness(); t.after(h.close);
  h.rpc.state.genesisHash = 'wrong-network'; assert.equal((await h.prepare()).status, 503); assert.equal(h.row(), undefined);
  assert.equal((await h.request('/rewards/config')).data.available, false); h.rpc.state.genesisHash = null;
  h.rpc.state.program.executable = false; assert.equal((await h.prepare()).status, 503); h.rpc.state.program.executable = true;
  h.rpc.state.mint.data[44] = 9; assert.equal((await h.prepare()).status, 503); h.rpc.state.mint.data[44] = 6;
  h.rpc.state.mint.data.writeUInt32LE(1, 46); assert.equal((await h.prepare()).status, 503); h.rpc.state.mint.data.writeUInt32LE(0, 46);
  assert.equal((await h.prepare()).status, 200);
  assert.ok(!JSON.stringify((await h.request('/rewards/config')).data).includes('private-test-rpc-key'));
});

test('integer amounts, concurrent idempotent preparation, expiry retirement and safe cancellation', async (t) => {
  const h = await harness(); t.after(h.close);
  for (const amount of [10, '0', '-1', '1e2', '0.0000001', '1000000.000001', 'NaN', '1,00']) assert.equal((await h.prepare({ amount })).status, 400);
  for (const days of [0, -1, 1.5, '7', 366]) assert.equal((await h.prepare({ days })).status, 400);
  const [a, b] = await Promise.all([h.prepare(), h.prepare()]); assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.data.transaction, b.data.transaction); assert.equal(a.data.reward.id, b.data.reward.id);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM rewards').get().n, 1);
  assert.equal((await h.prepare({ amount: '11' })).status, 409);
  h.rpc.state.accounts.set(h.row().address, { data: Buffer.alloc(0), owner: PublicKey.default, executable: false, lamports: 1 });
  assert.equal((await h.prepare()).data.transaction, a.data.transaction, 'SOL prefunding cannot poison an uninitialized draft PDA');
  assert.equal((await h.sync({ signature: '1'.repeat(88) })).data.reward.status, 'draft', 'unknown signature cannot mark deposit funded');
  const cancel = () => h.request(`${h.endpoint}/cancel`, { token: h.owner.token, body: { wallet: h.ownerWallet.publicKey.toBase58() } });
  assert.equal((await cancel()).data.code, 'REWARD_PENDING');
  h.rpc.state.blockHeight = a.data.lastValidBlockHeight + 1; h.rpc.state.error = true;
  assert.equal((await cancel()).status, 503, 'outage cannot retire a potentially signed transaction');
  h.rpc.state.error = false; assert.deepEqual((await cancel()).data, { reward: null });
  const next = await h.prepare(); assert.notEqual(next.data.reward.id, a.data.reward.id); assert.notEqual(next.data.reward.address, a.data.reward.address);
  assert.equal((await h.request(`/tags/${h.tag.id}`, { token: h.owner.token })).data.tag.code, h.tag.code);
});

test('pending/live deposits guard tag transfer, advertised reward edits, pausing and premature resolution during RPC outages', async (t) => {
  const h = await harness(); t.after(h.close); const target = await h.register(); const found = await h.report(); await h.prepare();
  const patch = (body) => h.request(`/tags/${h.tag.id}`, { token: h.owner.token, method: 'PATCH', body });
  assert.equal((await patch({ rewardAmount: 100 })).data.code, 'REWARD_LOCKED');
  assert.equal((await patch({ rewardCurrency: 'SKR' })).data.code, 'REWARD_LOCKED');
  assert.equal((await patch({ status: 'paused' })).data.code, 'REWARD_LOCKED');
  assert.equal((await patch({ status: 'lost' })).status, 200);
  const transfer = () => h.request(`/tags/${h.tag.id}/transfer`, { token: h.owner.token, body: { email: target.user.email, password: 'correct horse battery' } });
  assert.equal((await transfer()).data.code, 'REWARD_LOCKED');
  assert.equal((await h.request(`/reports/${found.report.id}/resolve`, { token: h.owner.token, body: {} })).data.code, 'REWARD_PAYMENT_REQUIRED');
  h.rpc.writeReceipt(h.row()); await h.sync(); h.rpc.state.error = true;
  assert.equal((await h.request(h.endpoint, { token: h.owner.token })).data.reward.status, 'unavailable');
  assert.equal((await h.request(`/public/tags/${h.tag.code}/reward`)).data.reward.status, 'unavailable');
  assert.equal((await h.request(`/reports/${found.report.id}/resolve`, { token: h.owner.token, body: {} })).status, 503);
  assert.equal((await transfer()).data.code, 'REWARD_LOCKED');
  assert.equal((await patch({ status: 'paused' })).data.code, 'REWARD_LOCKED');
  assert.ok(!JSON.stringify((await h.sync()).data).includes('credential'));
});

test('chain verification rejects substituted receipts, mint/token owners, amounts, bumps, authorities, and underfunded vaults', async (t) => {
  const h = await harness(); t.after(h.close); await h.prepare(); const row = h.row();
  const mutations = [
    () => h.rpc.state.accounts.get(row.address).owner = Keypair.generate().publicKey,
    () => h.rpc.state.accounts.get(row.address).data[16] ^= 1,
    () => h.rpc.state.accounts.get(row.address).data[48] ^= 1,
    () => h.rpc.state.accounts.get(row.address).data[80] ^= 1,
    () => h.rpc.state.accounts.get(row.address).data[112] ^= 1,
    () => h.rpc.state.accounts.get(row.address).data[10] ^= 1,
    () => h.rpc.state.accounts.get(row.address).data[11] ^= 1,
    () => h.rpc.state.accounts.get(row.vault).owner = Keypair.generate().publicKey,
    () => h.rpc.state.accounts.get(row.vault).data[32] ^= 1,
    () => h.rpc.state.accounts.get(row.vault).data[0] ^= 1,
    () => h.rpc.state.accounts.get(row.vault).data[108] = 2,
    () => h.rpc.state.accounts.get(row.vault).data.writeBigUInt64LE(1n, 64),
    () => h.rpc.state.program.executable = false,
  ];
  for (const mutation of mutations) { h.rpc.writeReceipt(row); h.rpc.state.program.executable = true; mutation(); assert.equal((await h.sync()).status, 503); assert.equal(h.row().chain_status, 'draft'); }
  h.rpc.state.program.executable = true; h.rpc.writeReceipt(row, { balance: BigInt(row.amount_units) + 1n }); assert.equal((await h.sync()).data.reward.status, 'funded', 'donation does not invalidate reserved principal');
  h.rpc.state.accounts.delete(row.address); assert.equal((await h.sync()).status, 503, 'a disappeared previously funded receipt never becomes draft');
});

test('finder Ed25519 challenges bind domain, report, wallet, nonce and expiry; proof cannot replay or cross reports', async (t) => {
  const h = await harness(); t.after(h.close); await h.fund(); const found = await h.report(); const other = await h.report();
  const proof = await h.proof(found); assert.match(proof.challenge.message, /Domain: http:\/\/localhost:8081/); assert.ok(proof.challenge.message.includes(found.report.id));
  assert.equal((await h.request(proof.prefix + '/verify', { token: other.token, body: proof.body })).status, 404);
  assert.equal((await h.request(`/finder/reports/${other.report.id}/reward/wallet/verify`, { token: other.token, body: proof.body })).data.code, 'INVALID_CHALLENGE');
  assert.equal((await h.request(proof.prefix + '/verify', { token: found.token, body: { ...proof.body, wallet: Keypair.generate().publicKey.toBase58() } })).data.code, 'INVALID_CHALLENGE');
  assert.equal((await h.request(proof.prefix + '/verify', { token: found.token, body: { ...proof.body, signature: Buffer.alloc(64).toString('base64') } })).data.code, 'INVALID_SIGNATURE');
  assert.equal((await h.request(proof.prefix + '/verify', { token: found.token, body: proof.body })).status, 200);
  assert.equal((await h.request(proof.prefix + '/verify', { token: found.token, body: proof.body })).data.code, 'INVALID_CHALLENGE');
  const expired = await h.proof(other); h.app.locals.db.prepare('UPDATE reward_challenges SET expires_at=? WHERE nonce=?').run(clock() - 1, expired.body.nonce);
  assert.equal((await h.request(expired.prefix + '/verify', { token: other.token, body: expired.body })).data.code, 'INVALID_CHALLENGE');
  const fresh = await h.proof(other); const challengeRow = h.app.locals.db.prepare('SELECT message FROM reward_challenges WHERE nonce=?').get(fresh.body.nonce);
  h.app.locals.db.prepare('UPDATE reward_challenges SET message=? WHERE nonce=?').run(challengeRow.message.replace('http://localhost:8081', 'https://evil.example'), fresh.body.nonce);
  assert.equal((await h.request(fresh.prefix + '/verify', { token: other.token, body: fresh.body })).data.code, 'INVALID_SIGNATURE');
});

test('release locks recipient and exact report, validates transaction messages, and gates selected return on verified payout', async (t) => {
  const h = await harness(); t.after(h.close); await h.fund(); const found = await h.report(); const other = await h.report();
  const release = (report = found, address = h.ownerWallet.publicKey.toBase58()) => h.request(`/reports/${report.report.id}/reward/release`, { token: h.owner.token, body: { wallet: address } });
  assert.equal((await release()).data.code, 'REWARD_COMMITMENT_REQUIRED');
  const commit = () => h.request(`/reports/${found.report.id}/reward/commit`, { token: h.owner.token, body: { wallet: h.ownerWallet.publicKey.toBase58() } });
  assert.equal((await commit()).data.code, 'RECIPIENT_UNVERIFIED');
  assert.equal((await release(found, Keypair.generate().publicKey.toBase58())).data.code, 'WRONG_REWARD_WALLET');
  const proof = await h.proof(found); assert.equal((await h.request(proof.prefix + '/verify', { token: found.token, body: proof.body })).status, 200);
  const proof2 = await h.proof(other); assert.equal((await h.request(proof2.prefix + '/verify', { token: other.token, body: proof2.body })).status, 200);
  const conversation = await h.request(`/reports/${found.report.id}/reward/sync`, { token: h.owner.token, body: {} });
  assert.equal(conversation.data.recipient.wallet, proof.body.wallet); assert.match(conversation.data.recipient.reportRef, /^[0-9a-f]{64}$/); assert.equal(conversation.data.canResolve, false);
  const committed = await commit(); assert.equal(committed.status, 200, JSON.stringify(committed.data));
  h.rpc.writeReceipt(h.row(), { status: 'committed', recipient: proof.body.wallet, reportRef: conversation.data.recipient.reportRef });
  assert.equal((await h.sync()).data.reward.status, 'committed');
  const prepared = await release(); assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  assert.equal((await release()).data.transaction, prepared.data.transaction);
  assert.equal((await release(other)).data.code, 'REWARD_COMMITMENT_REQUIRED');
  assert.equal((await h.request(proof.prefix + '/challenge', { token: found.token, body: { wallet: Keypair.generate().publicKey.toBase58() } })).data.code, 'REWARD_PENDING');
  const intent = h.app.locals.db.prepare("SELECT * FROM reward_intents WHERE action='release'").get();
  assert.equal(Buffer.from(intent.report_reference, 'hex').length, 32); assert.ok(!prepared.data.transaction.includes(found.report.id));
  h.rpc.writeReceipt(h.row(), { status: 'paid', recipient: proof.body.wallet, reportRef: '01'.repeat(32), balance: 0n });
  assert.equal((await h.sync()).status, 503, 'a payout with another report reference is never credited');
  h.rpc.writeReceipt(h.row(), { status: 'paid', recipient: proof2.body.wallet, reportRef: intent.report_reference, balance: 0n });
  assert.equal((await h.sync()).status, 503, 'a different recipient is never credited');
  h.rpc.writeReceipt(h.row(), { status: 'paid', recipient: proof.body.wallet, reportRef: intent.report_reference, balance: 0n });
  const signature = '2'.repeat(88); const unrelated = Transaction.from(Buffer.from(prepared.data.transaction, 'base64')); unrelated.recentBlockhash = Keypair.generate().publicKey.toBase58();
  h.rpc.state.transactions.set(signature, { meta: { err: null }, transaction: { message: unrelated.compileMessage() } });
  assert.equal((await h.sync({ signature })).data.code, 'INVALID_TRANSACTION');
  h.rpc.state.transactions.set(signature, { meta: { err: null }, transaction: { message: Transaction.from(Buffer.from(prepared.data.transaction, 'base64')).compileMessage() } });
  const synced = await h.sync({ signature }); assert.equal(synced.data.reward.status, 'paid'); assert.equal(synced.data.reward.transactionSignature, signature);
  assert.equal((await h.request(`/reports/${other.report.id}/reward`, { token: h.owner.token })).data.canResolve, false);
  assert.equal((await h.request(`/reports/${other.report.id}/resolve`, { token: h.owner.token, body: {} })).data.code, 'REWARD_PAYMENT_REQUIRED');
  assert.equal((await h.request(`/reports/${found.report.id}/reward`, { token: h.owner.token })).data.canResolve, true);
  assert.equal((await h.request(`/reports/${found.report.id}/resolve`, { token: h.owner.token, body: {} })).status, 200);
  assert.equal((await release()).data.code, 'REPORT_RESOLVED');
  const next = await h.prepare(); assert.equal(next.status, 200); assert.notEqual(next.data.reward.address, synced.data.reward.address);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/reward`, { token: found.token })).data.reward.id, synced.data.reward.id, 'old conversation retains its receipt');
});

test('renewal extends the same receipt and QR; expiry guards refund and failed calls cannot fabricate settlement', async (t) => {
  const h = await harness(); t.after(h.close); await h.fund(); const found = await h.report(); const initial = h.row();
  const body = { wallet: h.ownerWallet.publicKey.toBase58() };
  assert.equal((await h.request(h.endpoint + '/refund', { token: h.owner.token, body })).data.code, 'REWARD_NOT_EXPIRED');
  assert.equal((await h.request(h.endpoint + '/renew', { token: h.owner.token, body: { ...body, days: 365 } })).data.code, 'INVALID_DURATION');
  const renewal = await h.request(h.endpoint + '/renew', { token: h.owner.token, body: { ...body, days: 15 } });
  assert.equal(renewal.status, 200); assert.equal(renewal.data.reward.address, initial.address); assert.equal(Number(renewal.data.intent.expiresAt), initial.expires_at + 15 * 86400);
  assert.equal((await h.sync({ signature: '3'.repeat(88) })).data.reward.expiresAt, new Date(initial.expires_at * 1000).toISOString());
  h.rpc.writeReceipt(h.row(), { expiry: Number(renewal.data.intent.expiresAt) }); assert.equal((await h.sync()).data.reward.status, 'funded');
  assert.equal(h.row().expires_at, Number(renewal.data.intent.expiresAt));
  assert.equal((await h.request(`/tags/${h.tag.id}`, { token: h.owner.token })).data.tag.code, h.tag.code);
  // Advance only the persisted fixture expiry and simulated chain; production
  // never trusts a client-provided clock, expiry, status, or report reference.
  h.app.locals.db.prepare('UPDATE rewards SET expires_at=? WHERE id=?').run(clock() - 1, initial.id);
  h.rpc.writeReceipt(h.row()); assert.equal((await h.sync()).data.reward.status, 'expired');
  const refund = await h.request(h.endpoint + '/refund', { token: h.owner.token, body }); assert.equal(refund.status, 200);
  h.rpc.writeReceipt(h.row(), { status: 'refunded', balance: 2n }); assert.equal((await h.sync()).data.reward.status, 'refunded');
  assert.equal((await h.request(`/reports/${found.report.id}/resolve`, { token: h.owner.token, body: {} })).status, 200);
  assert.equal((await h.request(h.endpoint + '/refund', { token: h.owner.token, body })).data.code, 'REWARD_NOT_FUNDED');
});

test('concurrent anonymous proof reads coalesce instead of starving the owner mutation queue', async (t) => {
  const h = await harness(); t.after(h.close); await h.fund();
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let unblock; const gate = new Promise(resolve => { unblock = resolve; }); let reads = 0;
  h.rpc.state.beforeEpoch = async () => { reads++; entered(); await gate; };
  const first = h.request(`/public/tags/${h.tag.code}/reward`); await started;
  const scans = Array.from({ length: 20 }, () => h.request(`/public/tags/${h.tag.code}/reward`));
  await new Promise(resolve => setTimeout(resolve, 50));
  const renewal = h.request(h.endpoint + '/renew', { token: h.owner.token, body: { wallet: h.ownerWallet.publicKey.toBase58(), days: 7 } });
  assert.equal(reads, 1, 'public requests share the one blocked RPC inspection');
  unblock();
  for (const response of await Promise.all([first, ...scans])) assert.equal(response.data.reward.status, 'funded');
  assert.equal((await renewal).status, 200);
  assert.equal(reads, 2, 'one public refresh and one authenticated mutation inspect the chain');
});

test('only accepted commitment freezes reward; finder waiver defeats pending-owner starvation and preserves the QR', async t => {
  const h = await harness(); t.after(h.close); await h.fund();
  const found = await h.report(); const impostor = await h.report();
  const ownerBody = { wallet: h.ownerWallet.publicKey.toBase58() };
  const path = `/reports/${found.report.id}/reward`;
  const finderPath = `/finder/reports/${found.report.id}/reward`;
  const proof = await h.proof(found);
  await h.request(proof.prefix + '/verify', { token: found.token, body: proof.body });
  assert.equal(h.row().chain_status, 'funded', 'a QR notice and wallet proof do not commit or extend the offer');
  const original = h.row();
  const committed = await h.request(path + '/commit', { token: h.owner.token, body: ownerBody });
  assert.equal(committed.status, 200);
  const ref = committed.data.intent.reportRef;
  h.rpc.writeReceipt(h.row(), { status: 'committed', recipient: proof.body.wallet, reportRef: ref });
  const active = await h.request(path + '/sync', { token: h.owner.token, body: {} });
  assert.equal(active.data.reward.status, 'committed'); assert.equal(active.data.commitmentMatchesReport, true);
  assert.equal(active.data.canResolve, false);
  assert.equal((await h.request(`/reports/${impostor.report.id}/reward`, { token: h.owner.token })).data.commitmentMatchesReport, false);
  for (const action of ['refund', 'renew', 'cancel']) assert.equal((await h.request(h.endpoint + '/' + action, { token: h.owner.token, body: { ...ownerBody, days: 7 } })).status, 409);
  assert.equal((await h.prepare()).status, 409);
  assert.equal((await h.request(`/tags/${h.tag.id}`, { method: 'PATCH', token: h.owner.token, body: { status: 'paused' } })).data.code, 'REWARD_LOCKED');
  assert.equal((await h.request(path + '/commit', { token: h.owner.token, body: ownerBody })).status, 409);
  assert.equal((await h.request(proof.prefix + '/challenge', { token: found.token, body: { wallet: proof.body.wallet } })).status, 409);
  assert.equal((await h.request(finderPath + '/waive', { token: h.owner.token, body: ownerBody })).status, 404);
  assert.equal((await h.request(finderPath + '/waive', { token: found.token, body: ownerBody })).status, 403);
  assert.equal((await h.request(`/finder/reports/${impostor.report.id}/reward/waive`, { token: impostor.token, body: { wallet: proof.body.wallet } })).status, 403);
  assert.equal((await h.request(path + '/release', { token: h.owner.token, body: ownerBody })).status, 200);
  const waiver = await h.request(finderPath + '/waive', { token: found.token, body: { wallet: proof.body.wallet } });
  assert.equal(waiver.status, 200, JSON.stringify(waiver.data));
  const transaction = Transaction.from(Buffer.from(waiver.data.transaction, 'base64'));
  assert.equal(transaction.feePayer.toBase58(), proof.body.wallet);
  assert.equal(transaction.instructions.length, 1); assert.equal(transaction.instructions[0].data[0], 5);
  assert.equal(h.row().chain_status, 'committed', 'preparing an unsigned waiver cannot clear the commitment');
  h.rpc.writeReceipt(h.row(), { claimSeq: 1n });
  const reopened = await h.request(finderPath + '/sync', { token: found.token, body: {} });
  assert.equal(reopened.data.reward.status, 'funded'); assert.equal(reopened.data.commitmentMatchesReport, false);
  assert.equal(reopened.data.reward.claimSeq, '1'); assert.equal(reopened.data.reward.recipientWallet, undefined);
  assert.equal(h.row().expires_at, original.expires_at); assert.equal(h.row().address, original.address);
  assert.equal((await h.request(`/tags/${h.tag.id}`, { token: h.owner.token })).data.tag.code, h.tag.code);
  assert.equal((await h.request(path + '/release', { token: h.owner.token, body: ownerBody })).data.code, 'REWARD_COMMITMENT_REQUIRED');
  const next = await h.request(path + '/commit', { token: h.owner.token, body: ownerBody });
  assert.equal(next.status, 200); assert.equal(next.data.intent.claimSeq, '1');
  h.rpc.writeReceipt(h.row(), { status: 'committed', recipient: proof.body.wallet, reportRef: ref, claimSeq: 2n });
  assert.equal((await h.sync()).data.reward.claimSeq, '2');
  h.rpc.writeReceipt(h.row(), { status: 'committed', recipient: proof.body.wallet, reportRef: ref, claimSeq: 1n });
  assert.equal((await h.sync()).status, 503, 'RPC sequence rollback fails closed');
});

test('accepted commitment remains payable after offer expiry; direct chain waiver reconciles without an API intent', async t => {
  const h = await harness(); t.after(h.close); await h.fund(); const found = await h.report();
  const proof = await h.proof(found); await h.request(proof.prefix + '/verify', { token: found.token, body: proof.body });
  const recipient = h.app.locals.db.prepare('SELECT * FROM reward_recipients WHERE report_id=?').get(found.report.id);
  h.app.locals.db.prepare('UPDATE rewards SET expires_at=? WHERE id=?').run(clock() - 10, h.row().id);
  h.rpc.writeReceipt(h.row(), { status: 'committed', recipient: recipient.wallet, reportRef: recipient.reference, committedAt: clock() - 30 });
  assert.equal((await h.sync()).data.reward.status, 'committed', 'offer expiry cannot turn a commitment into a refund');
  const ownerBody = { wallet: h.ownerWallet.publicKey.toBase58() };
  assert.equal((await h.request(h.endpoint + '/refund', { token: h.owner.token, body: ownerBody })).status, 409);
  const release = await h.request(`/reports/${found.report.id}/reward/release`, { token: h.owner.token, body: ownerBody });
  assert.equal(release.status, 200, JSON.stringify(release.data));
  h.rpc.writeReceipt(h.row(), { claimSeq: 1n });
  assert.equal((await h.sync()).data.reward.status, 'expired');
  // An unsent release is now impossible by state/sequence, so retire it at the
  // known block height before preparing a different owner action.
  h.rpc.state.blockHeight = release.data.lastValidBlockHeight + 1;
  assert.equal((await h.request(h.endpoint + '/refund', { token: h.owner.token, body: ownerBody })).status, 200);
});

test('v1 SQLite migration preserves rewards, intents, conversation links and recreates committed uniqueness', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'test.sqlite');
  const h = await harness({ dbPath }); let closed = false;
  t.after(async () => { if (!closed) await h.close(); });
  await h.fund(); const found = await h.report();
  const proof = await h.proof(found); await h.request(proof.prefix + '/verify', { token: found.token, body: proof.body });
  const db = h.app.locals.db; const original = h.row();
  db.prepare('INSERT INTO reward_report_history(report_id,reward_id) VALUES(?,?)').run(found.report.id, original.id);
  // Materialize the actual previous column set/constraints on disk, preserving
  // foreign keys from the rest of the application and from both reward tables.
  const rewardSql = `CREATE TABLE rewards_v1 (
    id TEXT PRIMARY KEY, tag_id TEXT NOT NULL REFERENCES tags(id), owner_id TEXT NOT NULL REFERENCES users(id),
    wallet TEXT NOT NULL, mint TEXT NOT NULL, program_id TEXT NOT NULL, cluster TEXT NOT NULL, genesis_hash TEXT NOT NULL,
    amount_units TEXT NOT NULL, reference TEXT UNIQUE NOT NULL, address TEXT UNIQUE NOT NULL, vault TEXT NOT NULL,
    expires_at INTEGER NOT NULL, chain_status TEXT NOT NULL CHECK(chain_status IN ('draft','funded','paid','refunded','cancelled')),
    recipient_wallet TEXT, paid_report_id TEXT REFERENCES reports(id), transaction_signature TEXT, created_at INTEGER NOT NULL, verified_at INTEGER
  ) STRICT;`;
  const intentSql = `CREATE TABLE reward_intents_v1 (
    id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES rewards(id), action TEXT NOT NULL CHECK(action IN ('fund','renew','release','refund')),
    target_expiry INTEGER NOT NULL, report_id TEXT REFERENCES reports(id), recipient_wallet TEXT, report_reference TEXT,
    transaction_data TEXT, blockhash TEXT, last_valid_block_height INTEGER,
    status TEXT NOT NULL CHECK(status IN ('building','pending','completed','expired')), created_at INTEGER NOT NULL
  ) STRICT;`;
  db.exec('PRAGMA foreign_keys=OFF'); db.exec(rewardSql); db.exec(intentSql);
  for (const name of ['rewards', 'reward_intents']) {
    const columns = db.prepare(`PRAGMA table_info(${name}_v1)`).all().map(row => row.name).join(',');
    db.exec(`INSERT INTO ${name}_v1 (${columns}) SELECT ${columns} FROM ${name}`);
  }
  db.exec('DROP TABLE reward_intents; DROP TABLE rewards; ALTER TABLE rewards_v1 RENAME TO rewards; ALTER TABLE reward_intents_v1 RENAME TO reward_intents; PRAGMA foreign_keys=ON;');
  await h.close(); closed = true;
  const reopened = createApp({ dbPath, rateLimits: false, rewards: { env: h.rpc.env, connection: h.rpc.connection } });
  t.after(() => reopened.locals.close());
  const migrated = reopened.locals.db;
  const row = migrated.prepare('SELECT * FROM rewards WHERE id=?').get(original.id);
  assert.equal(row.address, original.address); assert.equal(row.amount_units, original.amount_units); assert.equal(row.claim_seq, '0');
  assert.equal(migrated.prepare('SELECT COUNT(*) n FROM reward_intents').get().n, 1);
  assert.equal(migrated.prepare('SELECT reward_id FROM reward_report_history').get().reward_id, original.id);
  assert.equal(migrated.prepare('SELECT wallet FROM reward_recipients').get().wallet, proof.body.wallet);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(migrated.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const index = migrated.prepare("SELECT sql FROM sqlite_master WHERE name='rewards_one_live'").get().sql;
  assert.ok(index.includes("'committed'"));
  migrated.prepare("UPDATE rewards SET chain_status='committed',claim_seq='1' WHERE id=?").run(row.id);
  assert.equal(migrated.prepare('SELECT chain_status FROM rewards').get().chain_status, 'committed');
});

test('immutable proof history survives a direct commitment racing a legitimate wallet change', async t => {
  const h = await harness(); t.after(h.close); await h.fund(); const found = await h.report();
  const first = await h.proof(found); await h.request(first.prefix + '/verify', { token: found.token, body: first.body });
  const firstProof = h.app.locals.db.prepare('SELECT * FROM reward_recipients WHERE report_id=?').get(found.report.id);
  const second = await h.proof(found);
  h.rpc.state.afterSnapshot = async () => {
    h.rpc.state.afterSnapshot = null;
    h.rpc.writeReceipt(h.row(), { status: 'committed', recipient: firstProof.wallet, reportRef: firstProof.reference });
  };
  const verified = await h.request(second.prefix + '/verify', { token: found.token, body: second.body });
  assert.equal(verified.status, 200);
  const currentProof = h.app.locals.db.prepare('SELECT * FROM reward_recipients WHERE report_id=?').get(found.report.id);
  assert.equal(currentProof.wallet, second.body.wallet); assert.notEqual(currentProof.reference, firstProof.reference);
  const prefix = `/finder/reports/${found.report.id}/reward`;
  const synced = await h.request(prefix + '/sync', { token: found.token, body: {} });
  assert.equal(synced.status, 200, JSON.stringify(synced.data)); assert.equal(synced.data.reward.status, 'committed');
  assert.equal(synced.data.reward.recipientWallet, firstProof.wallet);
  assert.equal(synced.data.recipient.wallet, firstProof.wallet); assert.equal(synced.data.recipient.reportRef, firstProof.reference);
  assert.equal((await h.request(prefix + '/waive', { token: found.token, body: { wallet: second.body.wallet } })).status, 403);
  const release = await h.request(`/reports/${found.report.id}/reward/release`, { token: h.owner.token, body: { wallet: h.ownerWallet.publicKey.toBase58() } });
  assert.equal(release.status, 200); assert.equal(release.data.intent.recipientWallet, firstProof.wallet);
  assert.equal((await h.request(prefix + '/waive', { token: found.token, body: { wallet: firstProof.wallet } })).status, 200);
});
