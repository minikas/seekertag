import { amountToUnits, MAINNET_MINTS, REWARD_DECIMALS, REWARD_PROGRAM, validRewardSeconds } from '../shared/reward.ts';
import type { RewardAction, RewardConfig, RewardCurrency, RewardOperation, RewardView } from '../shared/reward.ts';

export type RewardIntent = { kind: RewardAction; currency: RewardCurrency; amount: string; days?: number; durationSeconds?: number; recipient?: string; reportHash?: string };
export const rewardLocked = (reward?: RewardView | null) => !!reward && !['released', 'refunded'].includes(reward.status);
export const rewardAwaitingConfirmation = (reward?: RewardView | null) => reward?.operation?.status === 'submitted';
export function rewardDeadline(days: number, refundAfter?: string | null, now = Date.now()) {
  return new Date(Math.max(now, refundAfter ? Date.parse(refundAfter) : now) + days * 86_400_000);
}
export function validateRewardIntent(operation: RewardOperation, intent: RewardIntent, config: RewardConfig, payer: string) {
  const mint = intent.currency === 'SOL' ? null : config.network === 'mainnet' ? MAINNET_MINTS[intent.currency] : config.mints[intent.currency];
  const spec = operation.spec;
  if (config.program !== REWARD_PROGRAM || operation.network !== config.network || operation.currency !== intent.currency || !config.currencies.includes(intent.currency)
    || spec.kind !== intent.kind || spec.payer !== payer || spec.verifier !== config.verifier || spec.mint !== mint
    || spec.amountUnits !== amountToUnits(intent.amount, REWARD_DECIMALS[intent.currency]).toString()
    || spec.days !== intent.days || spec.durationSeconds !== intent.durationSeconds || spec.recipient !== intent.recipient || spec.reportHash !== intent.reportHash) {
    throw new Error('A transação não corresponde à recompensa escolhida.');
  }
}

export type ReservationUnit = 'hours' | 'days' | 'months' | 'years';
export const RESERVATION_UNITS: Record<ReservationUnit, number> = { hours: 3_600, days: 86_400, months: 30 * 86_400, years: 365 * 86_400 };
export function reservationSeconds(quantity: string, unit: ReservationUnit): number | null {
  if (!/^\d{1,5}$/.test(quantity)) return null;
  const seconds = Number(quantity) * RESERVATION_UNITS[unit];
  return validRewardSeconds(seconds) ? seconds : null;
}
export function reservationDeadline(seconds: number, refundAfter?: string | null, now = Date.now()) {
  return new Date(Math.max(now, refundAfter ? Date.parse(refundAfter) : now) + seconds * 1_000);
}
export function rewardInput(value: string, locale: string) { return value.replace('.', locale.startsWith('en') ? '.' : ','); }
export function canonicalRewardAmount(value: string) { return value.replace(',', '.').replace(/[.]$/, ''); }
// No grouping while editing: the caret stays stable and a paste cannot silently
// turn an exponent, negative number or multiple separators into another amount.
export function maskRewardAmount(next: string, previous: string, currency: RewardCurrency, locale: string): string {
  if (!/^\d*(?:[.,]\d*)?$/.test(next)) return previous;
  const [whole, fraction] = next.replace(',', '.').split('.');
  if (whole.length > 7 || Number(whole) > 1_000_000 || (fraction?.length || 0) > REWARD_DECIMALS[currency]) return previous;
  const normalized = (whole.replace(/^0+(?=\d)/, '') || (fraction !== undefined ? '0' : '')) + (fraction !== undefined ? `.${fraction}` : '');
  return rewardInput(normalized, locale);
}
export function stepRewardAmount(value: string, currency: RewardCurrency, direction: -1 | 1, locale: string) {
  const decimals = REWARD_DECIMALS[currency]; let units = 0n;
  try { units = amountToUnits(canonicalRewardAmount(value), decimals); } catch { if (Number(canonicalRewardAmount(value)) !== 0) return value; }
  const scale = 10n ** BigInt(decimals); const step = currency === 'SOL' ? scale / 100n : scale;
  const changed = units + BigInt(direction) * step;
  const next = changed < 0n ? 0n : changed > 1_000_000n * scale ? 1_000_000n * scale : changed;
  const fraction = (next % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return rewardInput(`${next / scale}${fraction ? `.${fraction}` : ''}`, locale);
}
