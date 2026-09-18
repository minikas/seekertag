import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Transaction } from '@solana/web3.js';
import { createApp } from '../apps/api/app.js';
import { createRewardChain } from '../apps/api/rewards/chain.js';
import { root, key, configPath, assertDevnet, topUp, waitFor } from './devnet-rewards.mjs';
import { rewardPlatformFee } from '@seekertag/shared/reward';
const { createSignInMessage } = createRequire(new URL('../apps/api/package.json', import.meta.url))('@solana/wallet-standard-util');

await assertDevnet();
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const chain = createRewardChain({ network: 'devnet', rpcUrl: config.rpc, verifier: key('verifier'), treasury: config.treasury, feeBps: config.feeBps, testMints: config.mints });
const owner = key('devnet-qa-owner', true); const finder = key('devnet-qa-finder', true);
await topUp(owner.publicKey.toBase58(), config, 0.25, 20);
await topUp(finder.publicKey.toBase58(), config, 0.02, 1);
const app = createApp({ dbPath: ':memory:', publicUrl: 'https://seekertag-devnet.example', rateLimits: false, rewardChain: chain });
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
function proof(wallet, payload) {
  const privateKey = createPrivateKey({ type: 'pkcs8', format: 'der', key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(wallet.secretKey.slice(0, 32))]) });
  const message = createSignInMessage({ ...payload, address: wallet.publicKey.toBase58() });
  return { address: wallet.publicKey.toBuffer().toString('base64'), signedMessage: Buffer.from(message).toString('base64'), signature: sign(null, message, privateKey).toString('base64') };
}
async function request(path, token, body, expected = 200) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`); return data;
}
async function login(wallet) { const start = await request('/auth/wallet/challenge', null, {}); return request('/auth/wallet/verify', null, { challengeId: start.challengeId, ...proof(wallet, start.payload) }); }
async function execute(operation, token) {
  const tx = Transaction.from(Buffer.from(operation.transaction, 'base64')); tx.partialSign(owner);
  const result = await request(`/reward-operations/${operation.id}/submit`, token, { transaction: tx.serialize().toString('base64') }, 202);
  await waitFor(result.signature, operation.lastValidBlockHeight);
  const confirmed = await request(`/reward-operations/${operation.id}`, token); assert.equal(confirmed.status, 'confirmed');
  return { signature: result.signature, reward: confirmed.reward };
}
const evidence = [];
try {
  const { token } = await login(owner);
  for (const currency of ['SOL', 'USDC', 'SKR']) {
    const tag = (await request('/tags', token, { name: `Devnet QA ${currency}` }, 201)).tag;
    const before = await chain.balance(finder.publicKey.toBase58(), currency);
    const treasuryBefore = await chain.balance(config.treasury, currency);
    const prepare = body => request(`/tags/${tag.id}/reward/prepare`, token, body, 201);
    const deposit = await execute((await prepare({ kind: 'fund', currency, amount: currency === 'SOL' ? '0.002' : '1.25', durationSeconds: 3_600 })).operation, token);
    assert.equal(deposit.reward.status, 'reserved'); console.log(`${currency}: deposit finalized`);
    const earlyRefund = await request(`/tags/${tag.id}/reward/prepare`, token, { kind: 'refund' }, 409); assert.equal(earlyRefund.code, 'REWARD_LOCKED');
    const renewed = await execute((await prepare({ kind: 'renew', durationSeconds: 365 * 86_400 })).operation, token);
    assert.equal(Date.parse(renewed.reward.refundAfter) - Date.parse(deposit.reward.refundAfter), 365 * 86_400_000); console.log(`${currency}: renewal finalized; early refund rejected`);
    const report = await request(`/public/tags/${tag.code}/reports`, null, { finderName: 'Devnet QA', message: 'Test return, no real item' }, 201);
    const walletBase = `/finder/reports/${report.report.id}/reward/wallet`;
    const challenge = await request(`${walletBase}/challenge`, report.token, { language: 'en' });
    await request(`${walletBase}/verify`, report.token, { challengeId: challenge.challengeId, ...proof(finder, challenge.payload) });
    const paid = await execute((await prepare({ kind: 'release', reportId: report.report.id })).operation, token);
    assert.equal(paid.reward.status, 'released');
    const after = await chain.balance(finder.publicKey.toBase58(), currency);
    const fee = rewardPlatformFee(paid.reward.amountUnits, config.feeBps);
    assert.equal(BigInt(after.availableUnits) - BigInt(before.availableUnits), BigInt(paid.reward.amountUnits) - fee);
    const treasuryAfter = await chain.balance(config.treasury, currency);
    assert.equal(BigInt(treasuryAfter.availableUnits) - BigInt(treasuryBefore.availableUnits), fee);
    assert.equal((await request(`/reports/${report.report.id}`, token)).report.status, 'resolved');
    evidence.push({ currency, escrow: paid.reward.escrow, deposit: deposit.signature, renewal: renewed.signature, payout: paid.signature, recipient: finder.publicKey.toBase58() });
    writeFileSync(`${root}artifacts/devnet-reward-verification.json`, JSON.stringify({ network: 'devnet', program: config.program, checkedAt: new Date().toISOString(), evidence }, null, 2) + '\n');
    console.log(`${currency}: payout finalized; finder/treasury split and return verified`);
  }
} finally { await new Promise(resolve => server.close(resolve)); app.locals.close(); }
