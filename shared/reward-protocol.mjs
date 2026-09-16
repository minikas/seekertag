import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID };
export const REWARD_ACCOUNT_SIZE = 224;
export const REWARD_VERSION = 2;
export const MAX_REWARD_DURATION_SECONDS = 365 * 24 * 60 * 60;
const MAGIC = Buffer.from('SKREWRD2');
const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;
export const REWARD_ERRORS = Object.freeze({
  0: 'InvalidInstruction', 1: 'InvalidAccounts', 2: 'InvalidAuthority',
  3: 'InvalidAddress', 4: 'InvalidMint', 5: 'InvalidTokenAccount',
  6: 'InvalidAmount', 7: 'InvalidExpiry', 8: 'AlreadyInitialized',
  9: 'InvalidReceipt', 10: 'AlreadySettled', 11: 'Expired',
  12: 'NotExpired', 13: 'InsufficientVaultBalance', 14: 'InvalidReference',
  15: 'CommitmentActive', 16: 'CommitmentRequired', 17: 'StaleClaim', 18: 'ClaimOverflow',
});

function key(value) { return value instanceof PublicKey ? value : new PublicKey(value); }
function bytes32(value, name) {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new TypeError(`${name} must be 32 bytes`);
  return Buffer.from(value);
}
function integer(value, max, name, allowZero = false) {
  if (typeof value !== 'bigint' && !(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value))) {
    throw new TypeError(`${name} must be a bigint or canonical unsigned integer string`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || (!allowZero && parsed === 0n) || parsed > max) throw new RangeError(`${name} out of range`);
  return parsed;
}
function decimalsValue(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('decimals must be 0..18');
  return decimals;
}
export function parseAmount(value, decimals = 6) {
  decimalsValue(decimals);
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new TypeError('amount must be a plain decimal string');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new RangeError('amount has too many fractional digits');
  return integer(BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0'), U64_MAX, 'amount');
}
export function formatAmount(value, decimals = 6) {
  decimalsValue(decimals);
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw new RangeError('amount must be a nonnegative u64 bigint');
  if (decimals === 0) return value.toString();
  const padded = value.toString().padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}
export function deriveRewardAddresses(programId, owner, rewardId) {
  const program = key(programId);
  const [reward, rewardBump] = PublicKey.findProgramAddressSync([Buffer.from('reward'), key(owner).toBuffer(), bytes32(rewardId, 'rewardId')], program);
  const [vault, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from('vault'), reward.toBuffer()], program);
  return { reward, vault, rewardBump, vaultBump };
}
export function decodeReward(value) {
  const data = Buffer.from(value);
  if (data.length !== REWARD_ACCOUNT_SIZE || !data.subarray(0, 8).equals(MAGIC)
      || data[8] !== REWARD_VERSION || ![1, 2, 3, 4].includes(data[9])
      || data[12] > 18 || data.subarray(13, 16).some(byte => byte !== 0)) throw new Error('Invalid reward receipt');
  const status = { 1: 'funded', 2: 'paid', 3: 'refunded', 4: 'committed' }[data[9]];
  const amount = data.readBigUInt64LE(112);
  const expiresAt = data.readBigInt64LE(120);
  const createdAt = data.readBigInt64LE(192);
  const settledAt = data.readBigInt64LE(200);
  const claimSeq = data.readBigUInt64LE(208);
  const committedAt = data.readBigInt64LE(216);
  const recipientBytes = data.subarray(128, 160);
  const reportRef = Buffer.from(data.subarray(160, 192));
  const emptyRecipient = recipientBytes.every(byte => byte === 0);
  const emptyReference = reportRef.every(byte => byte === 0);
  const hasClaim = status === 'committed' || status === 'paid';
  if (amount === 0n || createdAt < 0n || expiresAt <= createdAt
      || (hasClaim && (claimSeq === 0n || emptyRecipient || emptyReference || committedAt < createdAt || committedAt >= expiresAt))
      || (!hasClaim && (!emptyRecipient || !emptyReference || committedAt !== 0n))
      || ((status === 'funded' || status === 'committed') && settledAt !== 0n)
      || (status === 'paid' && settledAt < committedAt)
      || (status === 'refunded' && settledAt < expiresAt)) throw new Error('Inconsistent reward receipt');
  return {
    version: data[8], status, rewardBump: data[10], vaultBump: data[11], decimals: data[12],
    owner: new PublicKey(data.subarray(16, 48)), mint: new PublicKey(data.subarray(48, 80)),
    rewardId: Buffer.from(data.subarray(80, 112)), amount, expiresAt,
    recipient: emptyRecipient ? null : new PublicKey(recipientBytes), reportRef, createdAt, settledAt, claimSeq, committedAt,
  };
}
function meta(pubkey, isWritable = false, isSigner = false) { return { pubkey: key(pubkey), isWritable, isSigner }; }
function canonicalAta(mint, owner, supplied) {
  const address = getAssociatedTokenAddressSync(key(mint), key(owner), false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  if (supplied && !key(supplied).equals(address)) throw new Error('Token account must be the canonical associated token account');
  return address;
}
export function createRewardInstruction({ programId, owner, mint, rewardId, amount, expiresAt, source }) {
  const { reward, vault } = deriveRewardAddresses(programId, owner, rewardId);
  const data = Buffer.alloc(49);
  data[0] = 0;
  bytes32(rewardId, 'rewardId').copy(data, 1);
  data.writeBigUInt64LE(integer(amount, U64_MAX, 'amount'), 33);
  data.writeBigInt64LE(integer(expiresAt, I64_MAX, 'expiresAt'), 41);
  return new TransactionInstruction({ programId: key(programId), keys: [meta(owner, true, true), meta(reward, true), meta(vault, true), meta(mint), meta(canonicalAta(mint, owner, source), true), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)], data });
}
export function releaseRewardInstruction({ programId, owner, mint, rewardId, recipient, claimSeq, destination }) {
  const { reward, vault } = deriveRewardAddresses(programId, owner, rewardId);
  if (key(recipient).equals(PublicKey.default)) throw new Error('Recipient must be nonzero');
  const data = Buffer.alloc(9);
  data[0] = 1;
  data.writeBigUInt64LE(integer(claimSeq, U64_MAX, 'claimSeq'), 1);
  return new TransactionInstruction({ programId: key(programId), keys: [meta(owner, false, true), meta(reward, true), meta(vault, true), meta(mint), meta(canonicalAta(mint, recipient, destination), true), meta(TOKEN_PROGRAM_ID)], data });
}
export function refundRewardInstruction({ programId, owner, mint, rewardId, destination }) {
  const { reward, vault } = deriveRewardAddresses(programId, owner, rewardId);
  return new TransactionInstruction({ programId: key(programId), keys: [meta(owner, false, true), meta(reward, true), meta(vault, true), meta(mint), meta(canonicalAta(mint, owner, destination), true), meta(TOKEN_PROGRAM_ID)], data: Buffer.from([2]) });
}
export function renewRewardInstruction({ programId, owner, rewardId, expiresAt }) {
  const { reward } = deriveRewardAddresses(programId, owner, rewardId);
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigInt64LE(integer(expiresAt, I64_MAX, 'expiresAt'), 1);
  return new TransactionInstruction({ programId: key(programId), keys: [meta(owner, false, true), meta(reward, true)], data });
}
export function commitRewardInstruction({ programId, owner, rewardId, recipient, reportRef, expectedSeq }) {
  const { reward } = deriveRewardAddresses(programId, owner, rewardId);
  const ref = bytes32(reportRef, 'reportRef');
  if (ref.every(byte => byte === 0) || key(recipient).equals(PublicKey.default)) throw new Error('Recipient and report reference must be nonzero');
  const data = Buffer.alloc(73);
  data[0] = 4;
  data.writeBigUInt64LE(integer(expectedSeq, U64_MAX - 1n, 'expectedSeq', true), 1);
  key(recipient).toBuffer().copy(data, 9);
  ref.copy(data, 41);
  return new TransactionInstruction({ programId: key(programId), keys: [meta(owner, false, true), meta(reward, true)], data });
}
export function waiveRewardInstruction({ programId, owner, rewardId, recipient, claimSeq }) {
  const { reward } = deriveRewardAddresses(programId, owner, rewardId);
  if (key(recipient).equals(PublicKey.default)) throw new Error('Recipient must be nonzero');
  const data = Buffer.alloc(9);
  data[0] = 5;
  data.writeBigUInt64LE(integer(claimSeq, U64_MAX, 'claimSeq'), 1);
  return new TransactionInstruction({ programId: key(programId), keys: [meta(recipient, false, true), meta(reward, true)], data });
}
