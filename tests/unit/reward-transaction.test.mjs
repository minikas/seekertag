import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { commitRewardInstruction, waiveRewardInstruction, refundRewardInstruction, createRewardInstruction, deriveRewardAddresses, releaseRewardInstruction, renewRewardInstruction } from '../../shared/reward-protocol.mjs';
import { rewardBaseUnits, rewardDeploymentReady, validateRewardTransaction } from '../../src/reward-transaction.ts';

const owner = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const programId = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const rewardId = Buffer.alloc(32, 7);
const blockhash = Keypair.generate().publicKey.toBase58();
const requestedAt = Date.now();
const expiresAt = BigInt(Math.floor(requestedAt / 1000) + 30 * 86400);
const config = { enabled: true, cluster: 'devnet', mint: mint.toBase58(), programId: programId.toBase58(), assetLabel: 'Test SKR' };
process.env.EXPO_PUBLIC_SKR_CLUSTER = config.cluster;
process.env.EXPO_PUBLIC_SKR_PROGRAM_ID = config.programId;
process.env.EXPO_PUBLIC_SKR_MINT = config.mint;
const reward = { id: 'reward-1', status: 'draft', claimSeq: '0', committedAt: null, amount: '100.000001', assetLabel: 'Test SKR', cluster: 'devnet', wallet: owner.toBase58(), expiresAt: new Date(Number(expiresAt) * 1000).toISOString(), address: deriveRewardAddresses(programId, owner, rewardId).reward.toBase58(), explorerUrl: null };
const intent = { id: 'intent-1', rewardId: rewardId.toString('hex'), mint: config.mint, programId: config.programId, amountBaseUnits: '100000001', expiresAt: expiresAt.toString(), claimSeq: '0' };
const expected = { action: 'fund', wallet: owner.toBase58(), amount: reward.amount, days: 30, previous: null, requestedAt };
const input = { owner, mint, programId, rewardId };
function encoded(instructions, feePayer = owner) { return new Transaction({ feePayer, recentBlockhash: blockhash }).add(...instructions).serialize({ requireAllSignatures: false }).toString('base64'); }
function prepared(overrides = {}) { return { reward, action: 'fund', wallet: owner.toBase58(), lastValidBlockHeight: 12345, intent, transaction: encoded([createRewardInstruction({ ...input, amount: 100000001n, expiresAt })]), ...overrides }; }

test('client uses exact integer units and rejects precision loss inputs', () => {
  assert.equal(rewardBaseUnits('100.000001'), 100000001n);
  assert.equal(rewardBaseUnits('18446744073709.551615'), 18446744073709551615n);
  for (const value of ['0', '-1', 'NaN', '1e6', '1,2', '1.0000001', '18446744073709.551616']) assert.throws(() => rewardBaseUnits(value));
});

test('client accepts the exact intended unsigned escrow transaction', () => {
  assert.equal(validateRewardTransaction(prepared(), config, expected).instructions.length, 1);
});

test('client rejects hidden transfers and altered deposit amounts before asking wallet', () => {
  const instruction = createRewardInstruction({ ...input, amount: 100000001n, expiresAt });
  const malicious = encoded([instruction, SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: 900000000 })]);
  assert.throws(() => validateRewardTransaction(prepared({ transaction: malicious }), config, expected), /não corresponde/);
  assert.throws(() => validateRewardTransaction(prepared({ transaction: encoded([createRewardInstruction({ ...input, amount: 100000002n, expiresAt })]) }), config, expected), /não corresponde/);
});

test('client rejects wallet, mint, program and canonical receipt substitutions', () => {
  for (const change of [
    { wallet: recipient.toBase58() },
    { intent: { ...intent, mint: recipient.toBase58() } },
    { intent: { ...intent, programId: recipient.toBase58() } },
    { reward: { ...reward, address: recipient.toBase58() } },
  ]) assert.throws(() => validateRewardTransaction(prepared(change), config, expected));
  assert.throws(() => validateRewardTransaction(prepared(), { ...config, cluster: 'mainnet-beta' }, expected));
});

test('release uses the immutable committed recipient, report and sequence even after offer expiry', () => {
  const reportRef = Buffer.alloc(32, 9).toString('hex');
  const committed = { ...reward, status: 'committed', claimSeq: '7', recipientWallet: recipient.toBase58(), reportRef, expiresAt: new Date(requestedAt - 10000).toISOString(), committedAt: new Date(requestedAt - 20000).toISOString() };
  const release = { ...expected, action: 'release', previous: committed, recipientWallet: recipient.toBase58(), reportRef, commitmentMatchesReport: true };
  const tx = encoded([
    createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, recipient), recipient, mint),
    releaseRewardInstruction({ ...input, recipient, claimSeq: 7n }),
  ]);
  const good = prepared({ reward: committed, action: 'release', intent: { ...intent, claimSeq: '7', recipientWallet: recipient.toBase58(), reportRef }, transaction: tx });
  assert.equal(validateRewardTransaction(good, config, release).instructions.length, 2);
  for (const altered of [
    { ...release, recipientWallet: owner.toBase58() },
    { ...release, reportRef: Buffer.alloc(32, 8).toString('hex') },
    { ...release, commitmentMatchesReport: false },
    { ...release, previous: { ...committed, status: 'funded' } },
    { ...release, previous: { ...committed, claimSeq: '8' } },
  ]) assert.throws(() => validateRewardTransaction(good, config, altered));
  const stale = encoded([createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, recipient), recipient, mint), releaseRewardInstruction({ ...input, recipient, claimSeq: 6n })]);
  assert.throws(() => validateRewardTransaction({ ...good, transaction: stale }, config, release));
});

test('commit fixes the selected proven wallet and report at exactly the current sequence', () => {
  const reportRef = Buffer.alloc(32, 9).toString('hex');
  const funded = { ...reward, status: 'funded', claimSeq: '3' };
  const commit = { ...expected, action: 'commit', previous: funded, recipientWallet: recipient.toBase58(), reportRef };
  const good = prepared({ reward: funded, action: 'commit', intent: { ...intent, claimSeq: '3', recipientWallet: recipient.toBase58(), reportRef }, transaction: encoded([commitRewardInstruction({ ...input, recipient, reportRef: Buffer.from(reportRef, 'hex'), expectedSeq: 3n })]) });
  assert.equal(validateRewardTransaction(good, config, commit).instructions.length, 1);
  assert.throws(() => validateRewardTransaction(good, config, { ...commit, reportRef: Buffer.alloc(32, 8).toString('hex') }));
  assert.throws(() => validateRewardTransaction(good, config, { ...commit, recipientWallet: owner.toBase58() }));
  assert.throws(() => validateRewardTransaction(good, config, { ...commit, previous: { ...funded, status: 'committed' } }));
  assert.throws(() => validateRewardTransaction(good, config, { ...commit, previous: { ...funded, claimSeq: '4' } }));
  assert.throws(() => validateRewardTransaction(good, config, { ...commit, requestedAt: Number(expiresAt) * 1000 + 1000 }));
});

test('waiver derives the original owner receipt but only finder signs and pays the fee', () => {
  const reportRef = Buffer.alloc(32, 9).toString('hex');
  const committed = { ...reward, status: 'committed', claimSeq: '7', recipientWallet: recipient.toBase58(), reportRef, committedAt: new Date(requestedAt).toISOString() };
  const waiver = { ...expected, action: 'waive', wallet: recipient.toBase58(), previous: committed, recipientWallet: recipient.toBase58(), reportRef, commitmentMatchesReport: true };
  const instruction = waiveRewardInstruction({ ...input, recipient, claimSeq: 7n });
  const good = prepared({ reward: committed, action: 'waive', wallet: recipient.toBase58(), intent: { ...intent, claimSeq: '7', recipientWallet: recipient.toBase58(), reportRef }, transaction: encoded([instruction], recipient) });
  assert.equal(validateRewardTransaction(good, config, waiver).feePayer.toBase58(), recipient.toBase58());
  assert.throws(() => validateRewardTransaction({ ...good, transaction: encoded([instruction], owner) }, config, waiver));
  assert.throws(() => validateRewardTransaction(good, config, { ...waiver, wallet: owner.toBase58() }));
  assert.throws(() => validateRewardTransaction(good, config, { ...waiver, commitmentMatchesReport: false }));
  assert.throws(() => validateRewardTransaction({ ...good, reward: { ...committed, wallet: recipient.toBase58() } }, config, waiver));
  const transfer = SystemProgram.transfer({ fromPubkey: recipient, toPubkey: owner, lamports: 9999 });
  assert.throws(() => validateRewardTransaction({ ...good, transaction: encoded([instruction, transfer], recipient) }, config, waiver));
  assert.throws(() => validateRewardTransaction({ ...good, transaction: encoded([waiveRewardInstruction({ ...input, recipient, claimSeq: 6n })], recipient) }, config, waiver));
});

test('committed receipts cannot use renewal, refund or another deposit instructions', () => {
  const reportRef = Buffer.alloc(32, 9).toString('hex');
  const committed = { ...reward, status: 'committed', claimSeq: '2', recipientWallet: recipient.toBase58(), reportRef, committedAt: new Date(requestedAt).toISOString() };
  for (const action of ['renew', 'refund', 'fund']) {
    const tx = action === 'refund'
      ? encoded([createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, owner), owner, mint), refundRewardInstruction(input)])
      : action === 'renew' ? encoded([renewRewardInstruction({ ...input, expiresAt: expiresAt + 7n * 86400n })]) : prepared().transaction;
    const payload = prepared({ reward: committed, action, intent: { ...intent, claimSeq: '2' }, transaction: tx });
    assert.throws(() => validateRewardTransaction(payload, config, { ...expected, action, previous: committed, days: 7 }));
  }
});

test('renewal preserves identity and balance and cannot silently shorten selected extension', () => {
  const renewal = { ...expected, action: 'renew', previous: { ...reward, status: 'funded' }, days: 7 };
  const nextExpiry = expiresAt + 7n * 86400n;
  const good = prepared({ reward: { ...reward, status: 'funded' }, action: 'renew', intent: { ...intent, expiresAt: nextExpiry.toString() }, transaction: encoded([renewRewardInstruction({ programId, owner, rewardId, expiresAt: nextExpiry })]) });
  assert.equal(validateRewardTransaction(good, config, renewal).instructions.length, 1);
  assert.throws(() => validateRewardTransaction({ ...good, intent: { ...good.intent, expiresAt: expiresAt.toString() } }, config, renewal));
  assert.throws(() => validateRewardTransaction({ ...good, reward: { ...reward, amount: '101' } }, config, renewal));
});


test('build pins reject server network downgrade and mislabeled real SKR', () => {
  const oldCluster = process.env.EXPO_PUBLIC_SKR_CLUSTER;
  const oldProgram = process.env.EXPO_PUBLIC_SKR_PROGRAM_ID;
  const oldMint = process.env.EXPO_PUBLIC_SKR_MINT;
  const skr = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
  try {
    process.env.EXPO_PUBLIC_SKR_CLUSTER = 'mainnet-beta';
    process.env.EXPO_PUBLIC_SKR_PROGRAM_ID = programId.toBase58();
    process.env.EXPO_PUBLIC_SKR_MINT = skr.toBase58();
    const mainnet = { ...config, cluster: 'mainnet-beta', mint: skr.toBase58(), assetLabel: 'SKR' };
    const good = prepared({ reward: { ...reward, cluster: 'mainnet-beta', assetLabel: 'SKR' }, intent: { ...intent, mint: skr.toBase58() }, transaction: encoded([createRewardInstruction({ ...input, mint: skr, amount: 100000001n, expiresAt })]) });
    assert.equal(validateRewardTransaction(good, mainnet, expected).instructions.length, 1);
    assert.throws(() => validateRewardTransaction(prepared(), config, expected), /não corresponde/);
    delete process.env.EXPO_PUBLIC_SKR_PROGRAM_ID;
    assert.throws(() => validateRewardTransaction(good, mainnet, expected), /não corresponde/);
    process.env.EXPO_PUBLIC_SKR_CLUSTER = 'devnet';
    assert.throws(() => validateRewardTransaction({ ...good, reward: { ...good.reward, cluster: 'devnet' } }, { ...mainnet, cluster: 'devnet', assetLabel: 'Test SKR' }, expected), /não corresponde/);
  } finally {
    if (oldCluster === undefined) delete process.env.EXPO_PUBLIC_SKR_CLUSTER; else process.env.EXPO_PUBLIC_SKR_CLUSTER = oldCluster;
    if (oldProgram === undefined) delete process.env.EXPO_PUBLIC_SKR_PROGRAM_ID; else process.env.EXPO_PUBLIC_SKR_PROGRAM_ID = oldProgram;
    if (oldMint === undefined) delete process.env.EXPO_PUBLIC_SKR_MINT; else process.env.EXPO_PUBLIC_SKR_MINT = oldMint;
  }
});


test('all networks require bundled mint and program identities before enabling signatures', () => {
  assert.equal(rewardDeploymentReady(config), true);
  assert.equal(rewardDeploymentReady({ ...config, mint: recipient.toBase58() }), false);
  assert.equal(rewardDeploymentReady({ ...config, programId: recipient.toBase58() }), false);
  const savedMint = process.env.EXPO_PUBLIC_SKR_MINT;
  const savedProgram = process.env.EXPO_PUBLIC_SKR_PROGRAM_ID;
  try {
    delete process.env.EXPO_PUBLIC_SKR_MINT;
    assert.equal(rewardDeploymentReady(config), false);
    assert.throws(() => validateRewardTransaction(prepared(), config, expected));
    process.env.EXPO_PUBLIC_SKR_MINT = savedMint;
    delete process.env.EXPO_PUBLIC_SKR_PROGRAM_ID;
    assert.equal(rewardDeploymentReady(config), false);
    assert.throws(() => validateRewardTransaction(prepared(), config, expected));
  } finally { process.env.EXPO_PUBLIC_SKR_MINT = savedMint; process.env.EXPO_PUBLIC_SKR_PROGRAM_ID = savedProgram; }
});
