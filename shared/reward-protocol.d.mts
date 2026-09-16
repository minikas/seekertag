import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
export const REWARD_ACCOUNT_SIZE: 224;
export const REWARD_VERSION: 2;
export const MAX_REWARD_DURATION_SECONDS: number;
export const REWARD_ERRORS: Readonly<Record<number, string>>;
type Key = PublicKey | string;
type Integer = bigint | string;
interface RewardIdentity { programId: Key; owner: Key; rewardId: Uint8Array }
interface TokenReward extends RewardIdentity { mint: Key }
export interface RewardReceipt {
  version: number; status: 'funded' | 'committed' | 'paid' | 'refunded'; rewardBump: number; vaultBump: number; decimals: number;
  owner: PublicKey; mint: PublicKey; rewardId: Buffer; amount: bigint; expiresAt: bigint;
  recipient: PublicKey | null; reportRef: Buffer; createdAt: bigint; settledAt: bigint; claimSeq: bigint; committedAt: bigint;
}
export function parseAmount(value: string, decimals?: number): bigint;
export function formatAmount(value: bigint, decimals?: number): string;
export function deriveRewardAddresses(programId: Key, owner: Key, rewardId: Uint8Array): { reward: PublicKey; vault: PublicKey; rewardBump: number; vaultBump: number };
export function decodeReward(data: Uint8Array): RewardReceipt;
export function createRewardInstruction(args: TokenReward & { amount: Integer; expiresAt: Integer; source?: Key }): TransactionInstruction;
export function releaseRewardInstruction(args: TokenReward & { recipient: Key; claimSeq: Integer; destination?: Key }): TransactionInstruction;
export function refundRewardInstruction(args: TokenReward & { destination?: Key }): TransactionInstruction;
export function renewRewardInstruction(args: RewardIdentity & { expiresAt: Integer }): TransactionInstruction;
export function commitRewardInstruction(args: RewardIdentity & { recipient: Key; reportRef: Uint8Array; expectedSeq: Integer }): TransactionInstruction;
export function waiveRewardInstruction(args: RewardIdentity & { recipient: Key; claimSeq: Integer }): TransactionInstruction;
