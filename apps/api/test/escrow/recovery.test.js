import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Keypair, Transaction } from '@solana/web3.js';
import { MAINNET_MINTS } from '@seekertag/shared/reward';
import { createRewardChain } from '../../rewards/chain.js';
import { rpcHarness } from './rpc-harness.js';

async function fixture(t, mint = null) {
  const h = await rpcHarness();
  t.after(() => h.close());
  const owner = Keypair.generate(); h.fund(owner);
  const spec = { kind: 'fund', payer: owner.publicKey.toBase58(), verifier: h.verifier.publicKey.toBase58(), treasury: h.treasury.publicKey.toBase58(), feeBps: 500, rewardId: randomBytes(32).toString('hex'), amountUnits: '20000000', durationSeconds: 3600, mint };
  const reward = { payer: spec.payer, seed: spec.rewardId, verifier: spec.verifier, treasury: spec.treasury, fee_bps: spec.feeBps, mint, amount_units: spec.amountUnits };
  async function send(chain, changes) {
    const request = { ...spec, ...changes };
    const prepared = await chain.prepare(request);
    const tx = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
    tx.partialSign(owner);
    const signed = chain.signedPayload(tx.serialize().toString('base64'), prepared.transaction, request);
    await chain.send(signed.encoded);
  }
  const rotated = createRewardChain({ network: 'localnet', rpcUrl: h.rpcUrl, verifier: Keypair.generate(), treasury: Keypair.generate().publicKey.toBase58(), feeBps: 300, testMints: MAINNET_MINTS });
  return { h, spec, reward, send, rotated };
}

for (const [currency, mint] of [['SOL', null], ...Object.entries(MAINNET_MINTS)]) {
  test(`${currency}: lost legacy verifier permits renewal and expired refund, but not release`, async t => {
    const { h, spec, reward, send, rotated } = await fixture(t, mint);
    await send(h.chain, {});
    const original = await rotated.read(reward);
    await assert.rejects(send(rotated, { kind: 'refund' }));
    await assert.rejects(rotated.prepare({ ...spec, kind: 'release', recipient: Keypair.generate().publicKey.toBase58(), reportHash: randomBytes(32).toString('hex') }), /verificador desta reserva não está disponível/);
    await send(rotated, { kind: 'renew', durationSeconds: 3600 });
    const renewed = await rotated.read(reward);
    assert.equal(renewed.refundAfter, original.refundAfter + 3600);
    assert.equal(renewed.verifier, original.verifier);
    assert.equal(renewed.treasury, original.treasury);
    assert.equal(renewed.feeBps, original.feeBps);
    h.advance(3600);
    await assert.rejects(send(rotated, { kind: 'refund' }));
    h.advance(3600);
    await send(rotated, { kind: 'refund' });
    assert.equal((await rotated.read(reward)).status, 3);
  });
}

test('new deposits reject unofficial and stale platform parameters after rotation', async t => {
  const { h, spec, rotated } = await fixture(t);
  for (const changes of [
    { verifier: Keypair.generate().publicKey.toBase58() },
    { treasury: Keypair.generate().publicKey.toBase58() },
    { feeBps: 1 },
  ]) await assert.rejects(h.chain.prepare({ ...spec, ...changes }), /configuração/);
  await assert.rejects(rotated.prepare(spec), /configuração do verificador/);
  await assert.rejects(rotated.prepare({ ...spec, verifier: rotated.config.verifier }), /configuração da comissão/);
  await assert.doesNotReject(rotated.prepare({ ...spec, verifier: rotated.config.verifier, treasury: rotated.config.treasury, feeBps: rotated.config.feeBps }));
});

test('official receipt validation rejects substituted parameters and underfunded reserves', async t => {
  const { h, reward, send } = await fixture(t);
  await send(h.chain, {});
  for (const changes of [
    { verifier: Keypair.generate().publicKey.toBase58() },
    { treasury: Keypair.generate().publicKey.toBase58() },
    { fee_bps: 1 },
    { mint: MAINNET_MINTS.USDC },
    { amount_units: '1' },
  ]) await assert.rejects(h.chain.read({ ...reward, ...changes }), /validar a reserva/);
  const { escrowAddress } = await import('@seekertag/shared/escrow-wire');
  const address = escrowAddress(reward.payer, reward.seed).toBase58();
  const account = h.svm.getAccount(address);
  h.svm.setAccount({ address, executable: false, programAddress: account.programAddress, data: account.data, lamports: h.svm.minimumBalanceForRentExemption(BigInt(account.data.length)) });
  await assert.rejects(h.chain.read(reward), /validar o saldo/);
});
