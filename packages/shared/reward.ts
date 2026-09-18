export type RewardCurrency = 'SOL' | 'USDC' | 'SKR';
export type RewardNetwork = 'devnet' | 'testnet' | 'mainnet' | 'localnet';
export const REWARD_DECIMALS: Record<RewardCurrency, number> = { SOL: 9, USDC: 6, SKR: 6 };
export const REWARD_PROGRAM = '4vUZidqPqRNfVvagWxzZL4xBXeyJLrkuwKfKicVniQWB';
export const ESCROW_SPACE = 260;
export const DEFAULT_REWARD_PLATFORM_FEE_BPS = 500;
export const MAX_REWARD_PLATFORM_FEE_BPS = 1_000;
export const BPS_DENOMINATOR = 10_000;
// Fixed, bounded execution fee included in the transaction before wallet review.
export const REWARD_COMPUTE_UNITS = 200_000;
export const REWARD_COMPUTE_UNIT_PRICE = 100_000; // micro-lamports; 20,000 lamports total, verified on Seeker Wallet
// Wallet review caps each optional SOL account complement at 0.001 SOL.
// If network rent ever exceeds this policy, preparation fails for review.
export const MAX_SOL_ACCOUNT_TOP_UP_LAMPORTS = 1_000_000n;
export const MAINNET_MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SKR: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
};

// Money stays in integer base units across the API and transaction boundary.
export function amountToUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9 || typeof value !== 'string' || value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Valor de recompensa inválido.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals || BigInt(whole) > 1_000_000n) throw new Error('Valor de recompensa inválido.');
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units <= 0n || units > 1_000_000n * 10n ** BigInt(decimals)) throw new Error('Valor de recompensa inválido.');
  return units;
}
export function unitsToAmount(units: string | bigint, decimals: number): string {
  const value = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value / base}${fraction ? `.${fraction}` : ''}`;
}
export function rewardPlatformFee(units: string | bigint, feeBps = DEFAULT_REWARD_PLATFORM_FEE_BPS): bigint {
  if (!Number.isInteger(feeBps) || feeBps < 1 || feeBps > MAX_REWARD_PLATFORM_FEE_BPS) throw new Error('Taxa de plataforma inválida.');
  return BigInt(units) * BigInt(feeBps) / BigInt(BPS_DENOMINATOR);
}
export function validRewardDays(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365; }

export const MIN_REWARD_SECONDS = 3_600;
export const MAX_REWARD_SECONDS = 5 * 365 * 86_400;
export function validRewardSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_REWARD_SECONDS && value <= MAX_REWARD_SECONDS;
}
// Old day-based transactions retain their original ABI and limits.
export function rewardDuration(spec: { durationSeconds?: number; days?: number }): number {
  if (spec.durationSeconds !== undefined && spec.days === undefined && validRewardSeconds(spec.durationSeconds)) return spec.durationSeconds;
  if (spec.durationSeconds === undefined && validRewardDays(spec.days)) return spec.days * 86_400;
  throw new Error('Prazo inválido. Escolha de 1 hora a 5 anos.');
}

export type RewardStatus = 'pending' | 'reserved' | 'expired' | 'released' | 'refunded' | 'unverified';
export type RewardView = {
  id: string; status: RewardStatus; currency: RewardCurrency; amount: string; amountUnits: string;
  network: RewardNetwork; escrow: string; refundAfter: string | null; checkedAt: string | null;
  signature: string | null; operation?: { id: string; kind: RewardAction; status: string } | null;
};
export type RewardAction = 'fund' | 'renew' | 'release' | 'refund';
export type RewardInstructionSpec = {
  kind: RewardAction; payer: string; verifier: string; treasury: string; feeBps: number; rewardId: string; mint: string | null;
  amountUnits: string; days?: number; durationSeconds?: number; recipient?: string; reportHash?: string; previousRefundAfter?: number;
  computeBudget?: 'fixed-v1' | 'fixed-v2';
  solAccountTopUps?: { recipientLamports: string; treasuryLamports: string };
};
export function solAccountTopUpTotal(spec: RewardInstructionSpec): bigint {
  const topUps = spec.solAccountTopUps;
  if (topUps === undefined) return 0n; // Persisted operations retain their original wire format.
  if (spec.kind !== 'release' || spec.mint !== null || !spec.recipient || !topUps || typeof topUps !== 'object'
    || Object.keys(topUps).length !== 2 || !/^[1-9]\d{0,19}$/.test(spec.amountUnits)) throw new Error('Complemento de saldo inválido.');
  const values = [topUps.recipientLamports, topUps.treasuryLamports];
  if (values.some(value => typeof value !== 'string' || !/^(0|[1-9]\d{0,6})$/.test(value) || BigInt(value) > MAX_SOL_ACCOUNT_TOP_UP_LAMPORTS)) throw new Error('Complemento de saldo inválido.');
  const recipient = BigInt(topUps.recipientLamports); const treasury = BigInt(topUps.treasuryLamports);
  // A shared destination receives one complement; rounded-zero fees create no account.
  if (treasury > 0n && (spec.recipient === spec.treasury || rewardPlatformFee(spec.amountUnits, spec.feeBps) === 0n)) throw new Error('Complemento de saldo inválido.');
  return recipient + treasury;
}
export type RewardConfig = { network: RewardNetwork; verifier: string; verifiers: string[]; treasury: string; feeBps: number; program: string; currencies: RewardCurrency[]; mints: Partial<Record<RewardCurrency, string>>; minDays: number; maxDays: number; minSeconds: number; maxSeconds: number };
export type RewardBalance = { currency: RewardCurrency; decimals: number; mint: string | null; availableUnits: string; solLamports: string; fundableUnits?: string; reserveLamports?: string };
export type RewardOperationStatus = 'prepared' | 'submitted' | 'confirmed' | 'expired' | 'failed';
export type RewardOperation = {
  id: string; rewardId: string; network: RewardNetwork; currency: RewardCurrency; spec: RewardInstructionSpec;
  transaction: string; feeLamports: string; rentLamports: string; lastValidBlockHeight: number;
};

export type RewardPrices = { source: 'CoinGecko'; quotes: Partial<Record<RewardCurrency, { usd: number; brl: number; updatedAt: number }>>; fetchedAt: number; expiresAt: number };
