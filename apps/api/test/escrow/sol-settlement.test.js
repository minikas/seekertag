import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createPrivateKey, sign } from 'node:crypto';
import { once } from 'node:events';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { getTransactionDecoder } from '@solana/kit';
import { FailedTransactionMetadata } from 'litesvm';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { decodeEscrow, escrowAddress, rewardInstructions, verifyRewardTransaction } from '@seekertag/shared/escrow-wire';
import { rewardPlatformFee } from '@seekertag/shared/reward';
import { createRewardChain } from '../../rewards/chain.js';
import { createApp } from '../../app.js';
import { rpcHarness } from './rpc-harness.js';

async function fixture(t, amountUnits = '20000', { sharedDestination = false, recipientBalance = 0n, treasuryBalance = 0n } = {}) {
  const h = await rpcHarness(); t.after(() => h.close());
  const owner = Keypair.generate(); const finder = Keypair.generate(); const treasury = sharedDestination ? finder : Keypair.generate();
  h.fund(owner);
  if (recipientBalance) h.svm.airdrop(finder.publicKey.toBase58(), recipientBalance);
  if (treasuryBalance) h.svm.airdrop(treasury.publicKey.toBase58(), treasuryBalance);
  const chain = createRewardChain({ network: 'localnet', rpcUrl: h.rpcUrl, verifier: h.verifier, treasury: treasury.publicKey.toBase58() });
  const fund = { kind: 'fund', payer: owner.publicKey.toBase58(), verifier: h.verifier.publicKey.toBase58(), treasury: treasury.publicKey.toBase58(), feeBps: 500,
    rewardId: randomBytes(32).toString('hex'), amountUnits, durationSeconds: 3600, mint: null, computeBudget: 'fixed-v2' };
  const release = { ...fund, kind: 'release', recipient: finder.publicKey.toBase58(), reportHash: randomBytes(32).toString('hex') };
  delete release.durationSeconds;
  const balance = address => h.svm.getBalance(address) || 0n;
  const state = () => decodeEscrow(h.svm.getAccount(escrowAddress(fund.payer, fund.rewardId).toBase58()).data);
  async function send(prepared) {
    const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64')); tx.partialSign(owner);
    const signed = chain.signedPayload(tx.serialize().toString('base64'), prepared.transaction, prepared.spec);
    return chain.send(signed.encoded);
  }
  await send(await chain.prepare(fund));
  return { h, chain, owner, fund, release, state, balance, send, minimum: h.svm.minimumBalanceForRentExemption(0n) };
}

test('small SOL payout to two new wallets settles with exactly the reviewed minimum complements', async t => {
  const f = await fixture(t); const { release, minimum } = f;
  // Reproduce the original problem against the compiled contract and real rent rules.
  const legacy = new Transaction({ feePayer: f.owner.publicKey, recentBlockhash: f.h.svm.latestBlockhash() }).add(...rewardInstructions(release));
  legacy.sign(f.owner, f.h.verifier);
  assert.ok(f.h.svm.sendTransaction(getTransactionDecoder().decode(legacy.serialize())) instanceof FailedTransactionMetadata);
  assert.equal(f.state().status, 1);
  assert.equal(f.balance(release.recipient), 0n);
  const prepared = await f.chain.prepare(release);
  assert.equal(release.solAccountTopUps, undefined, 'preparation must preserve an existing review');
  assert.deepEqual(prepared.spec.solAccountTopUps, { recipientLamports: String(minimum - 19000n), treasuryLamports: String(minimum - 1000n) });
  assert.equal(prepared.rentLamports, String(2n * minimum - 20000n));
  const ownerBefore = f.balance(release.payer);
  await f.send(prepared);
  assert.equal(f.balance(release.recipient), minimum);
  assert.equal(f.balance(release.treasury), minimum);
  assert.equal(ownerBefore - f.balance(release.payer), BigInt(prepared.feeLamports) + BigInt(prepared.rentLamports));
  assert.equal(f.state().status, 2);
  assert.equal(f.state().amountUnits, '20000');
});

test('a new treasury is complemented only by the shortfall after its earned commission', async t => {
  const f = await fixture(t, '10000000', { recipientBalance: 1000000n });
  const prepared = await f.chain.prepare(f.release);
  assert.deepEqual(prepared.spec.solAccountTopUps, { recipientLamports: '0', treasuryLamports: String(f.minimum - 500000n) });
  await f.send(prepared);
  assert.equal(f.balance(f.release.recipient), 10500000n);
  assert.equal(f.balance(f.release.treasury), f.minimum);
});

test('rounded-zero SOL commission does not fund or create an unused treasury', async t => {
  const f = await fixture(t, '1'); const prepared = await f.chain.prepare(f.release);
  assert.equal(rewardPlatformFee(f.release.amountUnits), 0n);
  assert.deepEqual(prepared.spec.solAccountTopUps, { recipientLamports: String(f.minimum - 1n), treasuryLamports: '0' });
  await f.send(prepared);
  assert.equal(f.balance(f.release.recipient), f.minimum);
  assert.equal(f.balance(f.release.treasury), 0n);
  assert.equal(f.h.svm.getAccount(f.release.treasury).exists, false);
  assert.equal(f.state().status, 2);
});

test('finder equal to treasury receives one minimum complement based on the combined payout', async t => {
  const f = await fixture(t, '20000', { sharedDestination: true }); const prepared = await f.chain.prepare(f.release);
  assert.deepEqual(prepared.spec.solAccountTopUps, { recipientLamports: String(f.minimum - 20000n), treasuryLamports: '0' });
  const tx = verifyRewardTransaction(prepared.transaction, prepared.spec);
  assert.equal(tx.instructions.filter(ix => ix.programId.equals(SystemProgram.programId)).length, 1);
  await f.send(prepared);
  assert.equal(f.balance(f.release.recipient), f.minimum);
  assert.equal(f.state().status, 2);
});

test('funded destinations preserve the legacy release instruction format without any extra debit', async t => {
  const f = await fixture(t, '20000', { recipientBalance: 1000000n, treasuryBalance: 1000000n });
  const prepared = await f.chain.prepare(f.release);
  assert.deepEqual(prepared.spec.solAccountTopUps, { recipientLamports: '0', treasuryLamports: '0' });
  assert.equal(prepared.rentLamports, '0');
  assert.doesNotThrow(() => verifyRewardTransaction(prepared.transaction, f.release));
  await f.send(prepared);
  assert.equal(f.balance(f.release.recipient), 1019000n);
  assert.equal(f.balance(f.release.treasury), 1001000n);
});

test('a payout already covering rent needs no complement even for fresh wallets', async t => {
  const f = await fixture(t, '20000000'); const prepared = await f.chain.prepare(f.release);
  assert.deepEqual(prepared.spec.solAccountTopUps, { recipientLamports: '0', treasuryLamports: '0' });
  await f.send(prepared);
  assert.equal(f.balance(f.release.recipient), 19000000n);
  assert.equal(f.balance(f.release.treasury), 1000000n);
});

test('a partially funded wallet receives only its remaining shortfall', async t => {
  const f = await fixture(t);
  f.h.svm.setAccount({ address: f.release.recipient, executable: false, programAddress: SystemProgram.programId.toBase58(), lamports: 500000n, data: new Uint8Array() });
  const prepared = await f.chain.prepare(f.release);
  assert.equal(prepared.spec.solAccountTopUps.recipientLamports, String(f.minimum - 500000n - 19000n));
  await f.send(prepared);
  assert.equal(f.balance(f.release.recipient), f.minimum);
});

test('preparation refuses a destination that is not a plain system wallet', async t => {
  const f = await fixture(t);
  f.h.svm.setAccount({ address: f.release.recipient, executable: false, programAddress: SystemProgram.programId.toBase58(), lamports: 1000000n, data: new Uint8Array(1) });
  await assert.rejects(f.chain.prepare(f.release), /Carteira de recebimento inválida/);
  assert.equal(f.state().status, 1);
});

test('a rent RPC error cannot prepare a SOL release with zero complements', async t => {
  const f = await fixture(t); const fetchRpc = globalThis.fetch; let failedRentRequests = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url) === f.h.rpcUrl && body.method === 'getMinimumBalanceForRentExemption' && body.params[0] === 0) {
      failedRentRequests++;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'Node is behind' } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return fetchRpc(url, options);
  });
  // web3.js turns this JSON-RPC error into zero instead of rejecting its promise.
  await assert.rejects(f.chain.prepare(f.release), /Não foi possível verificar o saldo mínimo da rede/);
  assert.equal(failedRentRequests, 1);
  assert.equal(f.release.solAccountTopUps, undefined);
  assert.equal(f.state().status, 1);
  assert.equal(f.balance(f.release.recipient), 0n);
  assert.equal(f.balance(f.release.treasury), 0n);
});

test('failed release rolls back all complements when the escrow has already been refunded', async t => {
  const f = await fixture(t); const payout = await f.chain.prepare(f.release);
  f.h.advance(3600);
  await f.send(await f.chain.prepare({ ...f.fund, kind: 'refund', durationSeconds: undefined }));
  await assert.rejects(f.send(payout), /already|AlreadySettled/i);
  assert.equal(f.state().status, 3);
  assert.equal(f.balance(f.release.recipient), 0n);
  assert.equal(f.balance(f.release.treasury), 0n);
});

test('wallet and server reject altered complement destinations, amounts and unauthorized transfers', async t => {
  const f = await fixture(t); const prepared = await f.chain.prepare(f.release);
  const encode = tx => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const original = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  const index = original.instructions.findIndex(ix => ix.programId.equals(SystemProgram.programId));
  for (const change of [
    tx => { tx.instructions[index].keys[1].pubkey = Keypair.generate().publicKey; },
    tx => { tx.instructions[index].data.writeBigUInt64LE(1000000n, 4); },
    tx => { tx.instructions.splice(index, 1); },
    tx => { tx.add(SystemProgram.transfer({ fromPubkey: f.owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })); },
  ]) {
    const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64')); change(tx);
    assert.throws(() => verifyRewardTransaction(encode(tx), prepared.spec));
    assert.throws(() => f.chain.signedPayload(encode(tx), prepared.transaction, prepared.spec));
  }
});

test('API persists computed complements, includes them in the balance guard, and confirms the reviewed payout', async t => {
  const rpc = await rpcHarness();
  const app = createApp({ dbPath: ':memory:', publicUrl: 'https://seekertag.example', rateLimits: false, rewardChain: rpc.chain });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); await rpc.close(); });
  async function request(path, token, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  function proof(wallet, payload) {
    const key = createPrivateKey({ type: 'pkcs8', format: 'der', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), wallet.secretKey.slice(0, 32)]) });
    const message = createSignInMessage({ ...payload, address: wallet.publicKey.toBase58() });
    return { address: wallet.publicKey.toBuffer().toString('base64'), signedMessage: Buffer.from(message).toString('base64'), signature: sign(null, message, key).toString('base64') };
  }
  const owner = Keypair.generate(); rpc.fund(owner); const finder = Keypair.generate();
  const challenge = (await request('/auth/wallet/challenge', null, {})).data;
  const auth = await request('/auth/wallet/verify', null, { challengeId: challenge.challengeId, ...proof(owner, challenge.payload) });
  assert.equal(auth.status, 200); const token = auth.data.token;
  const tag = (await request('/tags', token, { name: 'Small SOL reward' })).data.tag;
  async function submit(operation) {
    verifyRewardTransaction(operation.transaction, operation.spec);
    const tx = Transaction.from(Buffer.from(operation.transaction, 'base64')); tx.partialSign(owner);
    return request(`/reward-operations/${operation.id}/submit`, token, { transaction: tx.serialize().toString('base64') });
  }
  const fund = await request(`/tags/${tag.id}/reward/prepare`, token, { kind: 'fund', currency: 'SOL', amount: '0.00002', durationSeconds: 3600 });
  assert.equal(fund.status, 201); assert.equal((await submit(fund.data.operation)).status, 202);
  assert.equal((await request(`/tags/${tag.id}/reward`, token)).data.reward.status, 'reserved');
  const report = (await request(`/public/tags/${tag.code}/reports`, null, { message: 'Found it' })).data;
  const finderBase = `/finder/reports/${report.report.id}/reward/wallet`;
  const walletChallenge = (await request(`${finderBase}/challenge`, report.token, {})).data;
  assert.equal((await request(`${finderBase}/verify`, report.token, { challengeId: walletChallenge.challengeId, ...proof(finder, walletChallenge.payload) })).status, 200);
  const topUp = rpc.svm.minimumBalanceForRentExemption(0n) - 19000n;
  const setBalance = lamports => rpc.svm.setAccount({ address: owner.publicKey.toBase58(), executable: false, programAddress: SystemProgram.programId.toBase58(), data: new Uint8Array(), lamports });
  setBalance(30000n + topUp - 1n);
  const releaseBody = { kind: 'release', reportId: report.report.id, solAccountTopUps: { recipientLamports: '1', treasuryLamports: '999999' } };
  const insufficient = await request(`/tags/${tag.id}/reward/prepare`, token, releaseBody);
  assert.equal(insufficient.status, 409); assert.equal(insufficient.data.code, 'INSUFFICIENT_BALANCE');
  setBalance(1000000000n);
  const prepared = await request(`/tags/${tag.id}/reward/prepare`, token, releaseBody);
  assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
  const operation = prepared.data.operation;
  assert.deepEqual(operation.spec.solAccountTopUps, { recipientLamports: String(topUp), treasuryLamports: '0' });
  assert.equal(operation.rentLamports, String(topUp));
  const persisted = app.locals.db.prepare('SELECT spec FROM reward_operations WHERE id=?').get(operation.id);
  assert.deepEqual(JSON.parse(persisted.spec).solAccountTopUps, operation.spec.solAccountTopUps);
  assert.equal((await submit(operation)).status, 202);
  assert.equal((await request(`/tags/${tag.id}/reward`, token)).data.reward.status, 'released');
  assert.equal((await request(`/reports/${report.report.id}`, token)).data.report.status, 'resolved');
  assert.equal(rpc.svm.getBalance(finder.publicKey.toBase58()), rpc.svm.minimumBalanceForRentExemption(0n));
});
