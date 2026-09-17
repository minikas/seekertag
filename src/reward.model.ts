import { amountToUnits, MAINNET_MINTS, REWARD_DECIMALS, REWARD_PROGRAM } from '../shared/reward.ts';
import type { RewardAction, RewardConfig, RewardCurrency, RewardOperation, RewardView } from '../shared/reward.ts';

export type RewardIntent = { kind: RewardAction; currency: RewardCurrency; amount: string; days?: number; recipient?: string; reportHash?: string };
export const rewardLocked = (reward?: RewardView | null) => !!reward && !['released', 'refunded'].includes(reward.status);
export function rewardDeadline(days: number, refundAfter?: string | null, now = Date.now()) {
  return new Date(Math.max(now, refundAfter ? Date.parse(refundAfter) : now) + days * 86_400_000);
}
export function validateRewardIntent(operation: RewardOperation, intent: RewardIntent, config: RewardConfig, payer: string) {
  const mint = intent.currency === 'SOL' ? null : config.network === 'mainnet' ? MAINNET_MINTS[intent.currency] : config.mints[intent.currency];
  const spec = operation.spec;
  if (config.program !== REWARD_PROGRAM || operation.network !== config.network || operation.currency !== intent.currency || !config.currencies.includes(intent.currency)
    || spec.kind !== intent.kind || spec.payer !== payer || spec.verifier !== config.verifier || spec.mint !== mint
    || spec.amountUnits !== amountToUnits(intent.amount, REWARD_DECIMALS[intent.currency]).toString()
    || spec.days !== intent.days || spec.recipient !== intent.recipient || spec.reportHash !== intent.reportHash) {
    throw new Error('A transação não corresponde à recompensa escolhida.');
  }
}
