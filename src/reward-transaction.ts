import { Buffer } from 'buffer';
import { PublicKey, Transaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { commitRewardInstruction, waiveRewardInstruction, createRewardInstruction, deriveRewardAddresses, refundRewardInstruction, releaseRewardInstruction, renewRewardInstruction } from '../shared/reward-protocol.mjs';
import type { PreparedReward, Reward, RewardAction, RewardConfig } from './rewards.types';

const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';

export function rewardDeploymentReady(config: RewardConfig): boolean {
  const cluster = process.env.EXPO_PUBLIC_SKR_CLUSTER || 'devnet';
  const program = process.env.EXPO_PUBLIC_SKR_PROGRAM_ID;
  const mint = process.env.EXPO_PUBLIC_SKR_MINT;
  return !!program && !!mint && config.cluster === cluster && config.programId === program && config.mint === mint
    && (cluster === 'mainnet-beta' ? mint === SKR_MINT : mint !== SKR_MINT);
}

export type RewardExpectation = { action: RewardAction; wallet: string; amount?: string; days?: number; previous: Reward | null; recipientWallet?: string; reportRef?: string; commitmentMatchesReport?: boolean; requestedAt: number };

export function rewardBaseUnits(amount: string): bigint {
  if (!/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/.test(amount)) throw new Error('Informe um valor positivo com no máximo 6 casas decimais, usando ponto.');
  const [whole, decimals = ''] = amount.split('.');
  const value = BigInt(whole) * 1_000_000n + BigInt(decimals.padEnd(6, '0'));
  if (value <= 0n || value > 18_446_744_073_709_551_615n) throw new Error('O valor da recompensa está fora do limite.');
  return value;
}
function check(value: unknown): asserts value {
  if (!value) throw new Error('A transação recebida não corresponde à recompensa que você escolheu. Nenhuma assinatura foi solicitada.');
}
function hash(value: string | undefined): Buffer {
  check(value && /^[0-9a-f]{64}$/i.test(value));
  return Buffer.from(value, 'hex');
}

/** Rebuild the entire permitted message: no hidden transfers, delegates, extra signers or instructions. */
export function validateRewardTransaction(prepared: PreparedReward, config: RewardConfig, expected: RewardExpectation): Transaction {
  const { intent, reward } = prepared;
  check(config.enabled && prepared.action === expected.action && prepared.wallet === expected.wallet);
  check(rewardDeploymentReady(config));
  check(intent.programId === config.programId && intent.mint === config.mint);
  check(reward.cluster === config.cluster);
  const signer = new PublicKey(expected.wallet);
  const owner = new PublicKey(reward.wallet); const mint = new PublicKey(config.mint); const programId = new PublicKey(config.programId);
  const previous = expected.previous;
  const rewardId = hash(intent.rewardId);
  const { reward: address } = deriveRewardAddresses(programId, owner, rewardId);
  check(address.toBase58() === reward.address);
  if (expected.action !== 'fund') {
    check(previous && reward.address === previous.address && reward.id === previous.id && reward.wallet === previous.wallet);
    check(reward.status === previous.status && reward.claimSeq === previous.claimSeq);
  }
  check(typeof intent.claimSeq === 'string' && intent.claimSeq.length <= 20 && /^(0|[1-9][0-9]*)$/.test(intent.claimSeq));
  const claimSeq = BigInt(intent.claimSeq);
  check(claimSeq <= 18_446_744_073_709_551_615n);
  if (expected.action === 'fund') {
    check(owner.equals(signer) && claimSeq === 0n && reward.claimSeq === '0');
    check(!previous || ['draft', 'paid', 'refunded'].includes(previous.status));
  } else {
    check(intent.claimSeq === previous!.claimSeq);
    if (expected.action === 'waive') check(previous!.recipientWallet === expected.wallet);
    else check(owner.equals(signer));
  }
  if (expected.action === 'renew') check(previous && ['funded', 'expired'].includes(previous.status));
  if (expected.action === 'refund') check(previous?.status === 'expired');
  if (expected.action === 'commit') check(previous?.status === 'funded' && Date.parse(previous.expiresAt) > expected.requestedAt);
  if (expected.action === 'release' || expected.action === 'waive') {
    check(previous?.status === 'committed' && expected.commitmentMatchesReport === true);
    check(previous.recipientWallet === expected.recipientWallet && previous.reportRef === expected.reportRef);
    check(reward.recipientWallet === previous.recipientWallet && reward.reportRef === previous.reportRef);
  }
  const amount = BigInt(intent.amountBaseUnits);
  check(amount === rewardBaseUnits(expected.action === 'fund' ? expected.amount! : expected.previous!.amount));
  check(amount === rewardBaseUnits(reward.amount));
  const expiresAt = BigInt(intent.expiresAt);
  if (expected.action === 'fund' || expected.action === 'renew') {
    check(expected.days && [7, 15, 30].includes(expected.days));
    const previousSeconds = expected.action === 'renew' ? Math.floor(Date.parse(expected.previous!.expiresAt) / 1000) : 0;
    const target = BigInt(Math.max(Math.floor(expected.requestedAt / 1000), previousSeconds) + expected.days * 86400);
    // Preparation should be immediate; tolerate bounded client clock skew, never a shortened renewal.
    check(expiresAt >= target - 300n && expiresAt <= target + 300n);
    if (expected.action === 'renew') check(expiresAt > BigInt(previousSeconds));
  }
  const input = { programId, owner, mint, rewardId };
  const instructions = [];
  if (expected.action === 'fund') instructions.push(createRewardInstruction({ ...input, amount, expiresAt }));
  if (expected.action === 'renew') instructions.push(renewRewardInstruction({ programId, owner, rewardId, expiresAt }));
  if (expected.action === 'commit' || expected.action === 'release' || expected.action === 'waive') {
    check(expected.recipientWallet && intent.recipientWallet === expected.recipientWallet);
    check(expected.reportRef && intent.reportRef === expected.reportRef);
    const recipient = new PublicKey(expected.recipientWallet);
    if (expected.action === 'commit') instructions.push(commitRewardInstruction({ programId, owner, rewardId, recipient, reportRef: hash(expected.reportRef), expectedSeq: claimSeq }));
    if (expected.action === 'release') {
      instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, recipient), recipient, mint));
      instructions.push(releaseRewardInstruction({ ...input, recipient, claimSeq }));
    }
    if (expected.action === 'waive') instructions.push(waiveRewardInstruction({ programId, owner, rewardId, recipient, claimSeq }));
  }
  if (expected.action === 'refund') {
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, owner), owner, mint));
    instructions.push(refundRewardInstruction(input));
  }
  const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  check(transaction.feePayer?.equals(signer) && transaction.recentBlockhash && !transaction.nonceInfo);
  check(transaction.signatures.length === 1 && transaction.signatures[0].publicKey.equals(signer) && transaction.signatures.every(item => item.signature === null));
  // Comparing serialized messages handles privilege promotion when an account appears in several instructions.
  const rebuilt = new Transaction({ feePayer: signer, recentBlockhash: transaction.recentBlockhash }).add(...instructions);
  check(rebuilt.serializeMessage().equals(transaction.serializeMessage()));
  return transaction;
}
