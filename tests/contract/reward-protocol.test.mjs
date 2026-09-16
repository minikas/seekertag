import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  parseAmount, formatAmount, deriveRewardAddresses, decodeReward,
  createRewardInstruction, releaseRewardInstruction, refundRewardInstruction,
  renewRewardInstruction, commitRewardInstruction, waiveRewardInstruction,
  REWARD_ACCOUNT_SIZE, REWARD_VERSION, TOKEN_PROGRAM_ID,
} from '../../shared/reward-protocol.mjs';

const programId = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const rewardId = Buffer.alloc(32, 31);
const reportRef = Buffer.alloc(32, 37);
const identity = { programId, owner, mint, rewardId };

function receipt() {
  const { rewardBump, vaultBump } = deriveRewardAddresses(programId, owner, rewardId);
  const data = Buffer.alloc(REWARD_ACCOUNT_SIZE);
  data.write('SKREWRD2');
  data.set([2, 1, rewardBump, vaultBump, 6], 8);
  owner.toBuffer().copy(data, 16);
  mint.toBuffer().copy(data, 48);
  rewardId.copy(data, 80);
  data.writeBigUInt64LE(18446744073709551615n, 112);
  data.writeBigInt64LE(200n, 120);
  data.writeBigInt64LE(100n, 192);
  return data;
}

test('decimal amounts remain exact through u64 maximum', () => {
  assert.equal(parseAmount('100.000001'), 100000001n);
  assert.equal(parseAmount('0.000001'), 1n);
  assert.equal(parseAmount('18446744073709.551615'), (1n << 64n) - 1n);
  assert.equal(formatAmount((1n << 64n) - 1n), '18446744073709.551615');
  assert.equal(formatAmount(0n), '0');
  assert.equal(formatAmount(1000000n), '1');
  assert.equal(parseAmount('100', 0), 100n);
  for (const value of ['0', '-1', '+1', '1e6', '01', '.1', '1.', '1,2', ' 1', '1 ', '0.0000001', '18446744073709.551616', 1, null]) {
    assert.throws(() => parseAmount(value), `${JSON.stringify(value)} rejected`);
  }
  for (let decimals = 0; decimals <= 18; decimals++) {
    for (const amount of [1n, 9n, 100n, 9007199254740993n, (1n << 64n) - 1n]) {
      assert.equal(parseAmount(formatAmount(amount, decimals), decimals), amount);
    }
  }
});

test('PDA seeds bind program, owner and opaque reward identity', () => {
  const first = deriveRewardAddresses(programId, owner, rewardId);
  const same = deriveRewardAddresses(programId.toBase58(), owner.toBase58(), new Uint8Array(rewardId));
  assert.equal(first.reward.toBase58(), same.reward.toBase58());
  assert.equal(first.vault.toBase58(), same.vault.toBase58());
  assert.equal(PublicKey.isOnCurve(first.reward), false);
  assert.equal(PublicKey.isOnCurve(first.vault), false);
  for (const args of [[mint, owner, rewardId], [programId, recipient, rewardId], [programId, owner, reportRef]]) {
    assert.notEqual(first.reward.toBase58(), deriveRewardAddresses(...args).reward.toBase58());
  }
  for (const id of [Buffer.alloc(31), Buffer.alloc(33), rewardId.toString('hex'), []]) {
    assert.throws(() => deriveRewardAddresses(programId, owner, id));
  }
});

test('instruction wire layout and authority account flags match the program', () => {
  const { reward, vault } = deriveRewardAddresses(programId, owner, rewardId);
  const instruction = createRewardInstruction({ ...identity, amount: '100000001', expiresAt: 123456789n });
  assert.equal(instruction.programId.toBase58(), programId.toBase58());
  assert.equal(instruction.data.length, 49);
  assert.equal(instruction.data[0], 0);
  assert.deepEqual(instruction.data.subarray(1, 33), rewardId);
  assert.equal(instruction.data.readBigUInt64LE(33), 100000001n);
  assert.equal(instruction.data.readBigInt64LE(41), 123456789n);
  assert.deepEqual(instruction.keys.map(k => k.pubkey.toBase58()), [owner, reward, vault, mint,
    getAssociatedTokenAddressSync(mint, owner), SystemProgram.programId, TOKEN_PROGRAM_ID].map(k => k.toBase58()));
  assert.deepEqual(instruction.keys.map(k => [k.isSigner, k.isWritable]), [
    [true, true], [false, true], [false, true], [false, false], [false, true], [false, false], [false, false],
  ]);
  const release = releaseRewardInstruction({ ...identity, recipient, claimSeq: 2n });
  assert.equal(release.data.length, 9);
  assert.equal(release.data[0], 1);
  assert.equal(release.data.readBigUInt64LE(1), 2n);
  assert.equal(release.keys[4].pubkey.toBase58(), getAssociatedTokenAddressSync(mint, recipient).toBase58());
  const refund = refundRewardInstruction(identity);
  assert.deepEqual(refund.data, Buffer.from([2]));
  assert.equal(refund.keys[4].pubkey.toBase58(), getAssociatedTokenAddressSync(mint, owner).toBase58());
  const renew = renewRewardInstruction({ ...identity, expiresAt: 123456790n });
  assert.equal(renew.keys.length, 2);
  assert.equal(renew.data[0], 3);
  assert.equal(renew.data.readBigInt64LE(1), 123456790n);
  const commit = commitRewardInstruction({ ...identity, recipient, reportRef, expectedSeq: '1' });
  assert.equal(commit.data.length, 73);
  assert.equal(commit.data[0], 4);
  assert.equal(commit.data.readBigUInt64LE(1), 1n);
  assert.deepEqual(commit.data.subarray(9, 41), recipient.toBuffer());
  assert.deepEqual(commit.data.subarray(41, 73), reportRef);
  assert.deepEqual(commit.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [owner.toBase58(), true, false], [reward.toBase58(), false, true],
  ]);
  const waive = waiveRewardInstruction({ ...identity, recipient, claimSeq: 2n });
  assert.equal(waive.data.length, 9);
  assert.equal(waive.data[0], 5);
  assert.equal(waive.data.readBigUInt64LE(1), 2n);
  assert.deepEqual(waive.keys.map(k => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), [
    [recipient.toBase58(), true, false], [reward.toBase58(), false, true],
  ]);
});

test('builders reject unsafe integers, substituted token accounts and empty references', () => {
  for (const value of [0n, -1n, 100, Number.MAX_SAFE_INTEGER, '1.0', '01', (1n << 64n)]) {
    assert.throws(() => createRewardInstruction({ ...identity, amount: value, expiresAt: 200n }));
  }
  assert.throws(() => createRewardInstruction({ ...identity, amount: 1n, expiresAt: 1n << 63n }));
  assert.throws(() => createRewardInstruction({ ...identity, amount: 1n, expiresAt: 200n, source: recipient }));
  assert.throws(() => releaseRewardInstruction({ ...identity, recipient, claimSeq: 1n, destination: owner }));
  assert.throws(() => commitRewardInstruction({ ...identity, recipient, reportRef: Buffer.alloc(32), expectedSeq: 0n }));
  assert.throws(() => commitRewardInstruction({ ...identity, recipient: PublicKey.default, reportRef, expectedSeq: 0n }));
  assert.throws(() => releaseRewardInstruction({ ...identity, recipient: PublicKey.default, claimSeq: 1n }));
  assert.throws(() => waiveRewardInstruction({ ...identity, recipient: PublicKey.default, claimSeq: 1n }));
  assert.throws(() => refundRewardInstruction({ ...identity, destination: recipient }));
});

test('claim counters reject lossy numbers, overflow, missing and zero active sequence', () => {
  const maximum = (1n << 64n) - 1n;
  assert.equal(commitRewardInstruction({ ...identity, recipient, reportRef, expectedSeq: 0n }).data.readBigUInt64LE(1), 0n);
  assert.equal(commitRewardInstruction({ ...identity, recipient, reportRef, expectedSeq: maximum - 1n }).data.readBigUInt64LE(1), maximum - 1n);
  for (const value of [undefined, -1n, 0, 1, '01', '1.0', maximum, maximum + 1n]) {
    assert.throws(() => commitRewardInstruction({ ...identity, recipient, reportRef, expectedSeq: value }));
  }
  for (const builder of [releaseRewardInstruction, waiveRewardInstruction]) {
    assert.equal(builder({ ...identity, recipient, claimSeq: maximum }).data.readBigUInt64LE(1), maximum);
    for (const value of [undefined, 0n, '0', -1n, 1, '01', maximum + 1n]) {
      assert.throws(() => builder({ ...identity, recipient, claimSeq: value }));
    }
  }
});

test('receipt decoder preserves all 64-bit fields and validates immutable shape', () => {
  const data = receipt();
  const decoded = decodeReward(data);
  assert.equal(REWARD_ACCOUNT_SIZE, 224);
  assert.equal(decoded.version, REWARD_VERSION);
  assert.equal(decoded.status, 'funded');
  assert.equal(decoded.amount, (1n << 64n) - 1n);
  assert.equal(decoded.owner.toBase58(), owner.toBase58());
  assert.equal(decoded.mint.toBase58(), mint.toBase58());
  assert.equal(decoded.expiresAt, 200n);
  assert.equal(decoded.createdAt, 100n);
  assert.equal(decoded.settledAt, 0n);
  assert.equal(decoded.claimSeq, 0n);
  assert.equal(decoded.committedAt, 0n);
  assert.equal(decoded.recipient, null);
  assert.deepEqual(decoded.rewardId, rewardId);
  for (const offset of [0, 8, 9, 12, 13, 14, 15, 128, 160, 200, 216]) {
    const corrupt = Buffer.from(data);
    corrupt[offset] = 99;
    assert.throws(() => decodeReward(corrupt), `corrupt field ${offset}`);
  }
  assert.throws(() => decodeReward(data.subarray(0, 208)));
  assert.throws(() => decodeReward(Buffer.concat([data, Buffer.from([0])])));
  data.writeBigUInt64LE((1n << 64n) - 1n, 208);
  assert.equal(decodeReward(data).claimSeq, (1n << 64n) - 1n, 'waiver preserves the sequence on an open offer');
});

test('commitment receipt binds recipient and sequence; payment remains valid past offer expiry', () => {
  const data = receipt();
  data[9] = 4;
  recipient.toBuffer().copy(data, 128);
  reportRef.copy(data, 160);
  data.writeBigUInt64LE(1n, 208);
  data.writeBigInt64LE(150n, 216);
  const committed = decodeReward(data);
  assert.equal(committed.status, 'committed');
  assert.equal(committed.recipient.toBase58(), recipient.toBase58());
  assert.deepEqual(committed.reportRef, reportRef);
  assert.equal(committed.claimSeq, 1n);
  assert.equal(committed.committedAt, 150n);
  for (const [offset, width] of [[128, 32], [160, 32], [208, 8]]) {
    const bad = Buffer.from(data); bad.fill(0, offset, offset + width);
    assert.throws(() => decodeReward(bad));
  }
  for (const time of [99n, 200n]) {
    const bad = Buffer.from(data); bad.writeBigInt64LE(time, 216);
    assert.throws(() => decodeReward(bad));
  }
  const unsettled = Buffer.from(data); unsettled.writeBigInt64LE(150n, 200);
  assert.throws(() => decodeReward(unsettled));
  data[9] = 2;
  for (const time of [150n, 199n, 200n, 300n]) {
    data.writeBigInt64LE(time, 200);
    assert.equal(decodeReward(data).status, 'paid');
  }
  data.writeBigInt64LE(149n, 200);
  assert.throws(() => decodeReward(data));
  data[9] = 3;
  data.fill(0, 128, 192);
  data.writeBigInt64LE(0n, 216);
  data.writeBigInt64LE(200n, 200);
  assert.equal(decodeReward(data).status, 'refunded');
  data.writeBigInt64LE(199n, 200);
  assert.throws(() => decodeReward(data));
});
