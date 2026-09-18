import { Buffer } from 'buffer';
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ESCROW_SPACE, MAX_REWARD_PLATFORM_FEE_BPS, REWARD_PROGRAM, REWARD_COMPUTE_UNITS, REWARD_COMPUTE_UNIT_PRICE, rewardDuration, solAccountTopUpTotal } from './reward.ts';
import type { RewardInstructionSpec } from './reward.ts';

export const PROGRAM = new PublicKey(REWARD_PROGRAM);
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const discriminators = { fund_sol_timed: '6802660e4e4b3ddd', fund_token_timed: '68108583de536a1a', renew_timed: '0a96388e58bace0f', fund_sol: '9c81db22a1d6e738', fund_token: '6175994b50771134', renew: '2bef0f2e1b07a349', release_sol: '3a4017c2d49c8909', release_token: 'c0b00f2c436b608f', refund_sol: '9e4483726a4d380d', refund_token: 'c6c25dd10cd32eae' };
const key = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
function writeUnits(buffer: Buffer, value: bigint, offset: number) {
  if (value < 0n || value > 0xffffffffffffffffn) throw new Error('Valor de recompensa inválido.');
  buffer.writeUInt32LE(Number(value & 0xffffffffn), offset);
  buffer.writeUInt32LE(Number(value >> 32n), offset + 4);
}
function hashBytes(hex: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(hex) || /^0+$/.test(hex)) throw new Error('Identificador de recompensa inválido.');
  return Buffer.from(hex, 'hex');
}
export function escrowAddress(payer: string, id: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('reward'), new PublicKey(payer).toBuffer(), hashBytes(id)], PROGRAM)[0];
}
export function vaultAddress(escrow: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), escrow.toBuffer()], PROGRAM)[0];
}
export function tokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}
export function createTokenAccount(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: ATA_PROGRAM, keys: [key(payer, true, true), key(tokenAddress(owner, mint), true), key(owner), key(mint), key(SystemProgram.programId), key(TOKEN_PROGRAM)], data: Buffer.from([1]) });
}
export function rewardInstructions(spec: RewardInstructionSpec): TransactionInstruction[] {
  solAccountTopUpTotal(spec);
  const owner = new PublicKey(spec.payer); const verifier = new PublicKey(spec.verifier);
  const treasury = new PublicKey(spec.treasury);
  if (!PublicKey.isOnCurve(treasury.toBytes()) || treasury.equals(owner) || treasury.equals(verifier) || !Number.isInteger(spec.feeBps) || spec.feeBps < 1 || spec.feeBps > MAX_REWARD_PLATFORM_FEE_BPS) throw new Error('Configuração da comissão inválida.');
  const escrow = escrowAddress(spec.payer, spec.rewardId); const mint = spec.mint ? new PublicKey(spec.mint) : null;
  const vault = vaultAddress(escrow); const setup: TransactionInstruction[] = [];
  if (spec.computeBudget !== undefined) {
    if (spec.computeBudget !== 'fixed-v1' && spec.computeBudget !== 'fixed-v2') throw new Error('Transação de recompensa inválida.');
    // Seed Vault Wallet fills in missing compute-budget instructions when
    // signing. Supply both up front so its response preserves the reviewed
    // message, including the verifier's partial signature on payouts.
    setup.push(ComputeBudgetProgram.setComputeUnitLimit({ units: REWARD_COMPUTE_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: spec.computeBudget === 'fixed-v1' ? 1_000 : REWARD_COMPUTE_UNIT_PRICE }));
  }
  let name: keyof typeof discriminators; let keys; let args: Buffer = Buffer.alloc(0);
  if (spec.kind === 'fund') {
    const seconds = rewardDuration(spec); const timed = spec.durationSeconds !== undefined;
    if (!/^[1-9]\d{0,19}$/.test(spec.amountUnits)) throw new Error('Dados de depósito inválidos.');
    args = Buffer.alloc(timed ? 110 : 108); hashBytes(spec.rewardId).copy(args); writeUnits(args, BigInt(spec.amountUnits), 32);
    if (timed) args.writeUInt32LE(seconds, 40); else args.writeUInt16LE(spec.days!, 40);
    verifier.toBuffer().copy(args, timed ? 44 : 42);
    treasury.toBuffer().copy(args, timed ? 76 : 74);
    args.writeUInt16LE(spec.feeBps, timed ? 108 : 106);
    name = timed ? (mint ? 'fund_token_timed' : 'fund_sol_timed') : (mint ? 'fund_token' : 'fund_sol');
    keys = mint ? [key(owner, true, true), key(escrow, true), key(mint), key(tokenAddress(owner, mint), true), key(vault, true), key(TOKEN_PROGRAM), key(SystemProgram.programId)] : [key(owner, true, true), key(escrow, true), key(SystemProgram.programId)];
  } else if (spec.kind === 'renew') {
    const seconds = rewardDuration(spec); const timed = spec.durationSeconds !== undefined;
    name = timed ? 'renew_timed' : 'renew'; args = Buffer.alloc(timed ? 4 : 2);
    if (timed) args.writeUInt32LE(seconds, 0); else args.writeUInt16LE(spec.days!, 0);
    keys = [key(owner, true, true), key(escrow, true)];
  } else if (spec.kind === 'release') {
    if (!spec.recipient || !spec.reportHash) throw new Error('Carteira de recebimento não confirmada.');
    const recipient = new PublicKey(spec.recipient);
    if (!PublicKey.isOnCurve(recipient.toBytes()) || recipient.equals(owner)) throw new Error('Carteira de recebimento inválida.');
    args = hashBytes(spec.reportHash); name = mint ? 'release_token' : 'release_sol';
    if (spec.solAccountTopUps) {
      const topUps = spec.solAccountTopUps;
      if (BigInt(topUps.recipientLamports) > 0n) setup.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: BigInt(topUps.recipientLamports) }));
      if (BigInt(topUps.treasuryLamports) > 0n) setup.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: treasury, lamports: BigInt(topUps.treasuryLamports) }));
    }
    if (mint) setup.push(createTokenAccount(owner, recipient, mint), createTokenAccount(owner, treasury, mint), createTokenAccount(owner, owner, mint));
    keys = mint ? [key(owner, true, true), key(verifier, false, true), key(escrow, true), key(recipient), key(treasury), key(mint), key(vault, true), key(tokenAddress(recipient, mint), true), key(tokenAddress(treasury, mint), true), key(tokenAddress(owner, mint), true), key(TOKEN_PROGRAM)] : [key(owner, true, true), key(verifier, false, true), key(escrow, true), key(recipient, true), key(treasury, true)];
  } else if (spec.kind === 'refund') {
    name = mint ? 'refund_token' : 'refund_sol';
    if (mint) setup.push(createTokenAccount(owner, owner, mint));
    keys = mint ? [key(owner, true, true), key(escrow, true), key(mint), key(vault, true), key(tokenAddress(owner, mint), true), key(TOKEN_PROGRAM)] : [key(owner, true, true), key(escrow, true)];
  } else throw new Error('Operação de recompensa inválida.');
  return [...setup, new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([Buffer.from(discriminators[name], 'hex'), args]) })];
}

// Verify instructions and the complete account privilege set without reordering
// public keys. web3's compiler uses localeCompare; Node and Hermes can order the
// same base58 keys differently. The signed wire message must remain untouched.
export function verifyRewardTransaction(encoded: string, spec: RewardInstructionSpec): Transaction {
  const transaction = Transaction.from(Buffer.from(encoded, 'base64'));
  if (!transaction.recentBlockhash) throw new Error('Transação de recompensa inválida.');
  const expected = rewardInstructions(spec);
  const message = transaction.compileMessage();
  const privileges = new Map<string, { isSigner: boolean; isWritable: boolean }>();
  const account = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => {
    const key = pubkey.toBase58(); const previous = privileges.get(key);
    privileges.set(key, { isSigner: isSigner || !!previous?.isSigner, isWritable: isWritable || !!previous?.isWritable });
  };
  account(new PublicKey(spec.payer), true, true);
  for (const ix of expected) {
    account(ix.programId, false, false);
    for (const key of ix.keys) account(key.pubkey, key.isSigner, key.isWritable);
  }
  const exactAccounts = message.accountKeys.length === privileges.size && new Set(message.accountKeys.map(key => key.toBase58())).size === privileges.size
    && message.accountKeys.every((key, i) => {
      const expected = privileges.get(key.toBase58());
      return expected && expected.isSigner === message.isAccountSigner(i) && expected.isWritable === message.isAccountWritable(i);
    });
  const exactInstructions = transaction.instructions.length === expected.length && transaction.instructions.every((ix, i) =>
    ix.programId.equals(expected[i].programId) && Buffer.from(ix.data).equals(Buffer.from(expected[i].data))
    && ix.keys.length === expected[i].keys.length && ix.keys.every((key, j) => key.pubkey.equals(expected[i].keys[j].pubkey)));
  if (!transaction.feePayer?.equals(new PublicKey(spec.payer)) || !exactAccounts || !exactInstructions) throw new Error('A transação não corresponde à recompensa exibida.');
  return transaction;
}

export function decodeEscrow(data: Uint8Array) {
  const b = Buffer.from(data);
  if (b.length !== ESCROW_SPACE || b.slice(0, 8).toString('hex') !== '1fd57bbbba16da9b') throw new Error('Conta de garantia inválida.');
  const status = b[160];
  if (![1, 2, 3].includes(status)) throw new Error('Estado de garantia inválido.');
  return { payer: new PublicKey(b.subarray(8, 40)).toBase58(), verifier: new PublicKey(b.subarray(40, 72)).toBase58(), mint: new PublicKey(b.subarray(72, 104)).toBase58(),
    rewardId: b.slice(104, 136).toString('hex'), amountUnits: b.readBigUInt64LE(136).toString(), depositedAt: Number(b.readBigInt64LE(144)), refundAfter: Number(b.readBigInt64LE(152)), status,
    recipient: new PublicKey(b.subarray(161, 193)).toBase58(), reportHash: b.slice(193, 225).toString('hex'), treasury: new PublicKey(b.subarray(225, 257)).toBase58(), feeBps: b.readUInt16LE(257), bump: b[259] };
}
