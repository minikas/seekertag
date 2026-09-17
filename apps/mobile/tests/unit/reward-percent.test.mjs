import test from 'node:test';
import assert from 'node:assert/strict';
import { percentageRewardAmount } from '../../src/reward.model.ts';

test('reward percentages round down to token precision and retain locale masks', () => {
  assert.equal(percentageRewardAmount('1000001', 'USDC', 25, 'pt-BR'), '0,25');
  assert.equal(percentageRewardAmount('1000000001', 'SOL', 75, 'en-US'), '0.75');
  assert.equal(percentageRewardAmount('1', 'SKR', 25, 'en-US'), '0');
  assert.equal(percentageRewardAmount('999999999', 'SOL', 100, 'en-US'), '0.999999999');
});
test('maximum obeys the reward limit without unsafe number conversions', () => {
  assert.equal(percentageRewardAmount('18446744073709551615', 'SOL', 100, 'pt-BR'), '1000000');
  assert.throws(() => percentageRewardAmount('100', 'SOL', 150, 'en-US'));
  assert.throws(() => percentageRewardAmount('-1', 'SOL', 25, 'en-US'));
});
