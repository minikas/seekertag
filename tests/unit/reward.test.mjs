import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRewardIntent, rewardDeadline, rewardLocked, rewardAwaitingConfirmation } from '../../src/reward.model.ts';
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

test('editing stays locked for submitted actions even when the reserve exists or the RPC is unavailable', () => {
  for (const kind of ['fund', 'renew', 'release', 'refund']) {
    for (const status of ['pending', 'reserved', 'expired', 'unverified']) {
      assert.equal(rewardAwaitingConfirmation({ status, operation: { kind, status: 'submitted' } }), true);
    }
  }
  for (const status of ['prepared', 'expired', 'failed', 'confirmed']) assert.equal(rewardAwaitingConfirmation({ status: 'reserved', operation: { status } }), false);
  assert.equal(rewardAwaitingConfirmation({ status: 'reserved', operation: null }), false);
  assert.equal(rewardAwaitingConfirmation(null), false);
});

import { reservationSeconds, reservationDeadline, maskRewardAmount, stepRewardAmount } from '../../src/reward.model.ts';
import { rewardDuration } from '../../shared/reward.ts';
test('reservation units have explicit bounds and exact deadlines, without month rollover or DST ambiguity', () => {
  assert.equal(reservationSeconds('1', 'hours'), 3600);
  assert.equal(reservationSeconds('60', 'minutes'), 3600);
  assert.equal(reservationSeconds('59', 'minutes'), null);
  assert.equal(reservationSeconds('2', 'months'), 60 * 86400);
  assert.equal(reservationSeconds('5', 'years'), 5 * 365 * 86400);
  for (const [value, unit] of [['0','hours'], ['6','years'], ['43801','hours'], ['1.5','days'], ['1e2','days'], ['-1','hours']]) assert.equal(reservationSeconds(value, unit), null);
  const now = Date.parse('2026-09-16T12:00:00Z');
  assert.equal(reservationDeadline(3600, null, now).toISOString(), '2026-09-16T13:00:00.000Z');
  assert.equal(reservationDeadline(3600, '2026-10-01T12:00:00Z', now).toISOString(), '2026-10-01T13:00:00.000Z');
  assert.equal(rewardDuration({ days: 30 }), rewardDuration({ durationSeconds: 30 * 86400 }));
  assert.throws(() => rewardDuration({ days: 30, durationSeconds: 3600 }));
});
test('amount mask and steppers preserve base-unit precision and reject ambiguous pastes', () => {
  assert.equal(maskRewardAmount('01.250001', '', 'USDC', 'pt-BR'), '1,250001');
  assert.equal(maskRewardAmount(',', '', 'SOL', 'pt-BR'), '0,');
  for (const value of ['1e3','-10','1,2.3','0.0000001','1000001']) assert.equal(maskRewardAmount(value, '1', 'USDC', 'en-US'), '1');
  assert.equal(stepRewardAmount('0.000000001','SOL',1,'en-US'), '0.010000001');
  assert.equal(stepRewardAmount('1,000001','USDC',-1,'pt-BR'), '0,000001');
  assert.equal(stepRewardAmount('0.5','SKR',-1,'en-US'), '0');
  assert.equal(stepRewardAmount('1000000','SOL',1,'en-US'), '1000000');
});

test('wallet intent rejects a changed period or a switch back to the legacy day instruction', () => {
  const config = { network: 'devnet', verifier: 'verifier', program: REWARD_PROGRAM, currencies: ['SOL'], mints: {} };
  const intent = { kind: 'fund', currency: 'SOL', amount: '0.01', durationSeconds: 3600 };
  const operation = { network: 'devnet', currency: 'SOL', spec: { kind: 'fund', payer: 'owner', verifier: 'verifier', mint: null, amountUnits: '10000000', durationSeconds: 3600 } };
  assert.doesNotThrow(() => validateRewardIntent(operation, intent, config, 'owner'));
  for (const patch of [{ durationSeconds: 86400 }, { days: 1 }, { days: 1, durationSeconds: undefined }]) {
    assert.throws(() => validateRewardIntent({ ...operation, spec: { ...operation.spec, ...patch } }, intent, config, 'owner'));
  }
});
