import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRewardIntent, rewardDeadline, rewardLocked } from '../../src/reward.model.ts';
import { MAINNET_MINTS, REWARD_PROGRAM } from '../../shared/reward.ts';

test('wallet review binds the transaction to the amount, currency, network, verifier and intended recipient', () => {
  const config = { network: 'mainnet', verifier: 'verifier', program: REWARD_PROGRAM, currencies: ['SOL','USDC','SKR'], mints: { USDC: 'untrusted' } };
  const intent = { kind: 'release', currency: 'USDC', amount: '12.000001', recipient: 'finder', reportHash: 'report' };
  const operation = { network: 'mainnet', currency: 'USDC', spec: { kind: 'release', payer: 'owner', verifier: 'verifier', mint: MAINNET_MINTS.USDC, amountUnits: '12000001', recipient: 'finder', reportHash: 'report' } };
  assert.doesNotThrow(() => validateRewardIntent(operation, intent, config, 'owner'));
  for (const patch of [{ payer: 'other' }, { amountUnits: '12000000' }, { mint: 'untrusted' }, { verifier: 'other' }, { recipient: 'other' }, { reportHash: 'other' }, { kind: 'refund' }, { days: 30 }]) {
    assert.throws(() => validateRewardIntent({ ...operation, spec: { ...operation.spec, ...patch } }, intent, config, 'owner'));
  }
  assert.throws(() => validateRewardIntent({ ...operation, network: 'devnet' }, intent, config, 'owner'));
  assert.throws(() => validateRewardIntent(operation, intent, { ...config, program: 'other' }, 'owner'));
});

test('renewal adds days after the current deadline, or today when it already expired', () => {
  const now = Date.parse('2026-09-16T12:00:00Z');
  assert.equal(rewardDeadline(7, '2026-10-01T12:00:00Z', now).toISOString(), '2026-10-08T12:00:00.000Z');
  assert.equal(rewardDeadline(7, '2026-09-01T12:00:00Z', now).toISOString(), '2026-09-23T12:00:00.000Z');
  for (const status of ['pending', 'unverified', 'reserved', 'expired']) assert.equal(rewardLocked({ status }), true);
  for (const status of ['released', 'refunded']) assert.equal(rewardLocked({ status }), false);
  assert.equal(rewardLocked(null), false);
});
